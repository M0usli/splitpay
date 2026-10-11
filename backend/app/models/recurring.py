import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import Category
from app.models.base import Base, enum_column_type


class RecurringExpense(Base):
    """A cost that repeats every month, such as rent or internet.

    It is a template, not an expense: once a month the app makes a real
    expense from it (see app/recurring.py).
    """

    __tablename__ = "recurring_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The person who pays it each month.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    merchant: Mapped[str] = mapped_column(String(200))
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    category: Mapped[Category] = mapped_column(enum_column_type(Category))
    notes: Mapped[str | None] = mapped_column(Text)
    # The day it is paid, 1 to 28, so the day exists in every month.
    day_of_month: Mapped[int]
    # No expense is made for a date before this one.
    start_date: Mapped[datetime.date] = mapped_column(Date)
    # False once the user stops it. Past expenses stay.
    is_active: Mapped[bool] = mapped_column(default=True)
    # How each month's expense is shared, in the same form as for an expense:
    # shared or not, and each person's part (empty means "split equally").
    is_shared: Mapped[bool] = mapped_column(default=False)
    shares: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
