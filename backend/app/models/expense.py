import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import Category
from app.models.base import Base, enum_column_type


class Expense(Base):
    """One saved expense, either entered by hand or created from a receipt."""

    __tablename__ = "expenses"
    # At most one expense per recurring cost per month. The database itself
    # refuses a second one, even if two requests try at the same moment.
    __table_args__ = (
        UniqueConstraint("recurring_id", "recurring_month", name="uq_expenses_recurring_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Who this expense belongs to: the person who paid. Every query filters on
    # it, so one user can never change another user's rows.
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
    # Set when the expense is shared: the household it is shared with. Empty
    # for a private expense.
    shared_household_id: Mapped[int | None] = mapped_column(
        ForeignKey("households.id", ondelete="SET NULL"), index=True
    )
    # When the expense was split item by item: the lines and who each one is
    # for, kept so the split can be opened and changed later. The amounts
    # that count are still the shares below; this is how they were reached.
    split_items: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    # Set when the expense was made from a recurring cost: which one, and for
    # which month ("YYYY-MM"). The unique rule below uses the pair.
    recurring_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_expenses.id", ondelete="SET NULL"), index=True
    )
    recurring_month: Mapped[str | None] = mapped_column(String(7))
    # True if the user corrected any field the AI extracted.
    was_edited: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # A relationship loads the rows of another table that point at this one,
    # here the expense's shares, and makes them a normal Python list.
    # "delete-orphan" deletes a share when it is removed from the list, and
    # "selectin" fetches the shares of many expenses with one extra query.
    shares: Mapped[list["ExpenseShare"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ExpenseShare.user_id"
    )

    @property
    def is_shared(self) -> bool:
        return self.shared_household_id is not None


class ExpenseShare(Base):
    """One person's part of a shared expense.

    The shares of an expense always add up to its total. The payer's own part
    is a share too, so "what the others owe" is every share except the payer's.
    """

    __tablename__ = "expense_shares"
    # One share per person per expense.
    __table_args__ = (UniqueConstraint("expense_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(
        ForeignKey("expenses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
