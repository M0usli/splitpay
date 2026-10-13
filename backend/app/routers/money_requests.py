import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.enums import MoneyRequestStatus, TransferKind
from app.identity import VerifiedUser
from app.models import MoneyRequest, User
from app.schemas.wallet import MoneyRequestCreate, MoneyRequestPay, MoneyRequestRead
from app.wallet import InsufficientFunds, get_or_create_wallet, move_money

router = APIRouter(prefix="/wallet/requests", tags=["wallet"])

# The list shows the most recent requests; older ones are not listed.
LIST_LIMIT = 100


def to_read(db: Session, request: MoneyRequest, user: User) -> MoneyRequestRead:
    """One request as `user` should see it."""
    is_incoming = request.to_user_id == user.id
    other_id = request.from_user_id if is_incoming else request.to_user_id
    return MoneyRequestRead(
        id=request.id,
        direction="incoming" if is_incoming else "outgoing",
        counterparty=db.scalar(select(User.email).where(User.id == other_id)),
        amount=request.amount,
        note=request.note,
        status=request.status,
        created_at=request.created_at,
    )


def get_pending_or_error(db: Session, request_id: int, *, user: User, asked: bool) -> MoneyRequest:
    """Find a request the user may act on, and lock it.

    `asked=True` is for the person who was asked to pay (pay, decline);
    `asked=False` is for the person who made the request (cancel).

    The row is locked until this request commits. If Pay is tapped on two
    devices at once, the second waits here and then sees it is already paid.
    """
    request = db.scalar(select(MoneyRequest).where(MoneyRequest.id == request_id).with_for_update())
    owner_id = None if request is None else (request.to_user_id if asked else request.from_user_id)
    if request is None or owner_id != user.id:
        # Also for someone else's request: the answer does not say it exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Request not found")
    return request


def require_pending(request: MoneyRequest) -> None:
    if request.status != MoneyRequestStatus.PENDING:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"This request was already {request.status.value}"
        )


def resolve(request: MoneyRequest, new_status: MoneyRequestStatus) -> None:
    request.status = new_status
    request.resolved_at = datetime.datetime.now(datetime.UTC)


@router.post("", response_model=MoneyRequestRead, status_code=status.HTTP_201_CREATED)
def create_request(
    payload: MoneyRequestCreate, db: DbSession, user: CurrentUser
) -> MoneyRequestRead:
    """Ask another user for money. Nothing moves until they pay."""
    if payload.to_email == user.email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="You cannot request money from yourself"
        )
    asked = db.scalar(select(User).where(User.email == payload.to_email))
    if asked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No account has this email")

    request = MoneyRequest(
        from_user_id=user.id,
        to_user_id=asked.id,
        amount=payload.amount,
        note=(payload.note or "").strip() or None,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return to_read(db, request, user)


@router.get("", response_model=list[MoneyRequestRead])
def list_requests(db: DbSession, user: CurrentUser) -> list[MoneyRequestRead]:
    """Requests the user made or received, newest first."""
    requests = db.scalars(
        select(MoneyRequest)
        .where(or_(MoneyRequest.from_user_id == user.id, MoneyRequest.to_user_id == user.id))
        .order_by(MoneyRequest.created_at.desc(), MoneyRequest.id.desc())
        .limit(LIST_LIMIT)
    ).all()
    return [to_read(db, request, user) for request in requests]


@router.post("/{request_id}/pay", response_model=MoneyRequestRead)
def pay_request(
    request_id: int, payload: MoneyRequestPay, db: DbSession, user: VerifiedUser
) -> MoneyRequestRead:
    """Pay a request from the wallet. The money moves and the request is closed together."""
    request = get_pending_or_error(db, request_id, user=user, asked=True)
    if request.status == MoneyRequestStatus.PAID:
        # A repeat of the tap that paid it: say so again, move nothing.
        return to_read(db, request, user)
    require_pending(request)

    requester = db.get(User, request.from_user_id)
    try:
        transfer = move_money(
            db,
            kind=TransferKind.REQUEST,
            source=get_or_create_wallet(db, user),
            destination=get_or_create_wallet(db, requester),
            amount=request.amount,
            idempotency_key=payload.idempotency_key,
            note=request.note,
        )
    except InsufficientFunds as error:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(error)) from error

    request.wallet_transfer_id = transfer.id
    resolve(request, MoneyRequestStatus.PAID)
    db.commit()
    db.refresh(request)
    return to_read(db, request, user)


@router.post("/{request_id}/decline", response_model=MoneyRequestRead)
def decline_request(request_id: int, db: DbSession, user: CurrentUser) -> MoneyRequestRead:
    """Say no to a request. Only the person who was asked can."""
    request = get_pending_or_error(db, request_id, user=user, asked=True)
    require_pending(request)
    resolve(request, MoneyRequestStatus.DECLINED)
    db.commit()
    db.refresh(request)
    return to_read(db, request, user)


@router.post("/{request_id}/cancel", response_model=MoneyRequestRead)
def cancel_request(request_id: int, db: DbSession, user: CurrentUser) -> MoneyRequestRead:
    """Take a request back. Only the person who made it can."""
    request = get_pending_or_error(db, request_id, user=user, asked=False)
    require_pending(request)
    resolve(request, MoneyRequestStatus.CANCELLED)
    db.commit()
    db.refresh(request)
    return to_read(db, request, user)
