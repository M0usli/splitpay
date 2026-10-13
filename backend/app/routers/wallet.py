from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.enums import TransferKind
from app.identity import is_verified
from app.models import User, Wallet, WalletTransfer
from app.notifications import money, notify
from app.pin import PayingUser
from app.schemas.wallet import (
    LimitsRead,
    SendRequest,
    TopUpRequest,
    TransactionRead,
    TransferResult,
    WalletRead,
)
from app.spending import daily_limit_for, remaining_today, spend
from app.wallet import find_transfer, get_balance, get_or_create_wallet, move_money

router = APIRouter(prefix="/wallet", tags=["wallet"])

# The history shows the most recent transfers; older ones are not listed.
HISTORY_LIMIT = 100


def to_transaction(db: Session, transfer: WalletTransfer, wallet: Wallet) -> TransactionRead:
    """One transfer as the owner of `wallet` should see it."""
    money_came_in = transfer.to_wallet_id == wallet.id
    other_wallet_id = transfer.from_wallet_id if money_came_in else transfer.to_wallet_id
    # The outside-world wallet has no user, so a top-up has no other person.
    counterparty = db.scalar(
        select(User.email)
        .join(Wallet, Wallet.user_id == User.id)
        .where(Wallet.id == other_wallet_id)
    )
    return TransactionRead(
        id=transfer.id,
        kind=transfer.kind,
        direction="in" if money_came_in else "out",
        amount=transfer.amount,
        counterparty=counterparty,
        note=transfer.note,
        created_at=transfer.created_at,
    )


def check_same_request(
    transfer: WalletTransfer, *, source: Wallet, destination: Wallet, amount
) -> None:
    """A reused key must be a repeat of the same request, not a different one."""
    same = (
        transfer.from_wallet_id == source.id
        and transfer.to_wallet_id == destination.id
        and transfer.amount == amount
    )
    if not same:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This request id was already used for a different transfer",
        )


@router.get("", response_model=WalletRead)
def get_wallet(db: DbSession, user: CurrentUser) -> WalletRead:
    wallet = get_or_create_wallet(db, user)
    balance = get_balance(db, wallet)
    db.commit()  # keeps the wallet if it was just made
    return WalletRead(balance=balance, currency=wallet.currency)


@router.get("/limits", response_model=LimitsRead)
def get_limits(db: DbSession, user: CurrentUser) -> LimitsRead:
    """The user's daily sending limit and what is left of it today."""
    wallet = get_or_create_wallet(db, user)
    daily_limit = daily_limit_for(db, user)
    remaining = remaining_today(db, user, wallet)
    db.commit()  # keeps the wallet if it was just made
    return LimitsRead(
        level="verified" if is_verified(db, user) else "unverified",
        daily_limit=daily_limit,
        sent_today=daily_limit - remaining,
        remaining=remaining,
    )


@router.post("/top-up", response_model=TransferResult)
def top_up(payload: TopUpRequest, db: DbSession, user: CurrentUser) -> TransferResult:
    """Add pretend money. It comes out of the outside-world wallet."""
    wallet = get_or_create_wallet(db, user)
    outside = get_or_create_wallet(db, None)
    transfer = move_money(
        db,
        kind=TransferKind.TOP_UP,
        source=outside,
        destination=wallet,
        amount=payload.amount,
        idempotency_key=payload.idempotency_key,
        allow_overdraft=True,
    )
    check_same_request(transfer, source=outside, destination=wallet, amount=payload.amount)
    db.commit()
    db.refresh(transfer)
    return TransferResult(
        transaction=to_transaction(db, transfer, wallet), balance=get_balance(db, wallet)
    )


@router.post("/send", response_model=TransferResult)
def send_money(payload: SendRequest, db: DbSession, user: PayingUser) -> TransferResult:
    """Send money to another user, found by their email."""
    if payload.to_email == user.email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="You cannot send money to yourself"
        )
    recipient = db.scalar(select(User).where(User.email == payload.to_email))
    if recipient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No account has this email")

    wallet = get_or_create_wallet(db, user)
    recipient_wallet = get_or_create_wallet(db, recipient)
    # A repeat of a request that already went through must not notify again.
    is_repeat = find_transfer(db, payload.idempotency_key) is not None
    transfer = spend(
        db,
        user,
        kind=TransferKind.SEND,
        destination=recipient_wallet,
        amount=payload.amount,
        idempotency_key=payload.idempotency_key,
        note=payload.note.strip() or None if payload.note else None,
    )
    check_same_request(transfer, source=wallet, destination=recipient_wallet, amount=payload.amount)
    if not is_repeat:
        reason = f" For: {transfer.note}" if transfer.note else ""
        notify(db, recipient.id, f"{user.email} sent you {money(transfer.amount)}.{reason}")
    db.commit()
    db.refresh(transfer)
    return TransferResult(
        transaction=to_transaction(db, transfer, wallet), balance=get_balance(db, wallet)
    )


@router.get("/transactions", response_model=list[TransactionRead])
def list_transactions(db: DbSession, user: CurrentUser) -> list[TransactionRead]:
    """Money in and out of the user's wallet, newest first."""
    wallet = get_or_create_wallet(db, user)
    transfers = db.scalars(
        select(WalletTransfer)
        .where(
            or_(
                WalletTransfer.from_wallet_id == wallet.id,
                WalletTransfer.to_wallet_id == wallet.id,
            )
        )
        .order_by(WalletTransfer.created_at.desc(), WalletTransfer.id.desc())
        .limit(HISTORY_LIMIT)
    ).all()
    result = [to_transaction(db, transfer, wallet) for transfer in transfers]
    db.commit()
    return result
