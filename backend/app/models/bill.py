import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SavedBiller(Base):
    """A company the user pays, with the user's account number there."""

    __tablename__ = "saved_billers"
    __table_args__ = (
        # The same account at the same company is saved once per user.
        UniqueConstraint(
            "user_id", "biller_code", "account_number", name="uq_saved_billers_account"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # A code from the list in app/billers.py.
    biller_code: Mapped[str] = mapped_column(String(40))
    account_number: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BillPayment(Base):
    """A bill that was paid from the wallet. This row is the receipt.

    The company and account number are copied here instead of pointing to
    the saved biller. A receipt must keep saying what was paid even after
    the saved biller is removed.
    """

    __tablename__ = "bill_payments"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_bill_payments_amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    biller_code: Mapped[str] = mapped_column(String(40))
    account_number: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    # The ledger row that moved the money. unique=True: one receipt per transfer.
    wallet_transfer_id: Mapped[int] = mapped_column(ForeignKey("wallet_transfers.id"), unique=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
