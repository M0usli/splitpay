import datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import Category
from app.models.base import Base, enum_column_type


class Expense(Base):
    """One saved expense, either entered by hand or created from a receipt."""

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Who this expense belongs to. Every query filters on it, so one user can
    # never see another user's rows.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Nullable so an expense can be entered by hand, without a receipt.
    receipt_id: Mapped[int | None] = mapped_column(ForeignKey("receipts.id", ondelete="SET NULL"))
    merchant: Mapped[str] = mapped_column(String(200))
    date: Mapped[datetime.date] = mapped_column(Date, index=True)
    # Numeric(10, 2) stores exact decimals: up to 10 digits, 2 after the point.
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    tax: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    category: Mapped[Category] = mapped_column(enum_column_type(Category), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    # A shared expense is split with the other member of the user's household.
    # server_default fills these in for rows that existed before the columns did.
    is_shared: Mapped[bool] = mapped_column(default=False, server_default=false())
    # The part, in percent, that the person who paid covers themselves. With
    # 50 the other person owes half of the total.
    payer_share_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), default=Decimal("50"), server_default="50"
    )
    # True if the user corrected any field the AI extracted.
    was_edited: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
