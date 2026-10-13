from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import CurrentUser
from app.billers import BILLERS, BILLERS_BY_CODE
from app.database import DbSession
from app.enums import TransferKind
from app.models import BillPayment, SavedBiller
from app.pin import PayingUser
from app.schemas.bill import (
    BillerRead,
    BillPay,
    BillPaymentRead,
    SavedBillerCreate,
    SavedBillerRead,
)
from app.spending import spend
from app.wallet import get_or_create_wallet

router = APIRouter(prefix="/bills", tags=["bills"])

# The list shows the most recent payments; older ones are not listed.
PAYMENTS_LIMIT = 100
MAX_SAVED_BILLERS = 20


def to_biller_read(code: str) -> BillerRead:
    biller = BILLERS_BY_CODE[code]
    return BillerRead(code=biller.code, name=biller.name, kind=biller.kind)


def to_saved_read(saved: SavedBiller) -> SavedBillerRead:
    return SavedBillerRead(
        id=saved.id, biller=to_biller_read(saved.biller_code), account_number=saved.account_number
    )


def to_payment_read(payment: BillPayment) -> BillPaymentRead:
    return BillPaymentRead(
        id=payment.id,
        reference=f"BP-{payment.id:06d}",
        biller=to_biller_read(payment.biller_code),
        account_number=payment.account_number,
        amount=payment.amount,
        currency=payment.currency,
        created_at=payment.created_at,
    )


@router.get("/billers", response_model=list[BillerRead])
def list_billers(user: CurrentUser) -> list[BillerRead]:
    """The companies that can be paid. All of them are made up."""
    return [to_biller_read(biller.code) for biller in BILLERS]


@router.get("/saved", response_model=list[SavedBillerRead])
def list_saved_billers(db: DbSession, user: CurrentUser) -> list[SavedBillerRead]:
    saved = db.scalars(
        select(SavedBiller).where(SavedBiller.user_id == user.id).order_by(SavedBiller.id)
    ).all()
    return [to_saved_read(item) for item in saved]


@router.post("/saved", response_model=SavedBillerRead, status_code=status.HTTP_201_CREATED)
def save_biller(payload: SavedBillerCreate, db: DbSession, user: CurrentUser) -> SavedBillerRead:
    """Remember a company and the user's account number there."""
    if payload.biller_code not in BILLERS_BY_CODE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown biller")

    same_account = (
        select(SavedBiller)
        .where(SavedBiller.user_id == user.id)
        .where(SavedBiller.biller_code == payload.biller_code)
        .where(SavedBiller.account_number == payload.account_number)
    )
    existing = db.scalar(same_account)
    if existing is not None:
        # Saving the same account twice is not an error: it is already there.
        return to_saved_read(existing)

    count = len(db.scalars(select(SavedBiller.id).where(SavedBiller.user_id == user.id)).all())
    if count >= MAX_SAVED_BILLERS:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"You can save at most {MAX_SAVED_BILLERS} billers"
        )

    saved = SavedBiller(
        user_id=user.id, biller_code=payload.biller_code, account_number=payload.account_number
    )
    db.add(saved)
    try:
        db.commit()
    except IntegrityError:
        # The same account was saved by another request a moment ago.
        db.rollback()
        return to_saved_read(db.scalars(same_account).one())
    db.refresh(saved)
    return to_saved_read(saved)


@router.delete("/saved/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_saved_biller(saved_id: int, db: DbSession, user: CurrentUser) -> None:
    """Forget a saved biller. Receipts of past payments are kept."""
    saved = db.get(SavedBiller, saved_id)
    if saved is None or saved.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Saved biller not found")
    db.delete(saved)
    db.commit()


@router.post("/pay", response_model=BillPaymentRead, status_code=status.HTTP_201_CREATED)
def pay_bill(payload: BillPay, db: DbSession, user: PayingUser) -> BillPaymentRead:
    """Pay a bill from the wallet and write its receipt, together.

    The money goes to the outside-world wallet, the opposite of a top-up:
    it leaves the app, as it would when a real company is paid.
    """
    saved = db.get(SavedBiller, payload.saved_biller_id)
    if saved is None or saved.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Saved biller not found")

    wallet = get_or_create_wallet(db, user)
    outside = get_or_create_wallet(db, None)
    transfer = spend(
        db,
        user,
        kind=TransferKind.BILL,
        destination=outside,
        amount=payload.amount,
        idempotency_key=payload.idempotency_key,
        note=BILLERS_BY_CODE[saved.biller_code].name,
    )

    # A repeat of the same request (a double tap) finds the transfer already
    # made, and the receipt that goes with it.
    payment = db.scalar(select(BillPayment).where(BillPayment.wallet_transfer_id == transfer.id))
    if payment is None:
        same_request = (
            transfer.from_wallet_id == wallet.id
            and transfer.to_wallet_id == outside.id
            and transfer.amount == payload.amount
            and transfer.kind == TransferKind.BILL
        )
        if not same_request:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="This request id was already used for a different transfer",
            )
        payment = BillPayment(
            user_id=user.id,
            biller_code=saved.biller_code,
            account_number=saved.account_number,
            amount=payload.amount,
            currency=wallet.currency,
            wallet_transfer_id=transfer.id,
        )
        db.add(payment)
    elif payment.user_id != user.id:
        # Someone else's request id: say nothing about their payment.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This request id was already used for a different transfer",
        )
    db.commit()
    db.refresh(payment)
    return to_payment_read(payment)


@router.get("/payments", response_model=list[BillPaymentRead])
def list_payments(db: DbSession, user: CurrentUser) -> list[BillPaymentRead]:
    """The user's bill receipts, newest first."""
    payments = db.scalars(
        select(BillPayment)
        .where(BillPayment.user_id == user.id)
        .order_by(BillPayment.created_at.desc(), BillPayment.id.desc())
        .limit(PAYMENTS_LIMIT)
    ).all()
    return [to_payment_read(payment) for payment in payments]
