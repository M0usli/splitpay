import datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.enums import Category

# A non-negative amount with at most 2 decimal places. Sent as a string in
# JSON (e.g. "12.50") so it never passes through a float.
Money = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]

# A share between 0 and 100, sent as a string like "50" or "33.33".
Percent = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]


class ExpenseBase(BaseModel):
    """Fields the user can set on an expense."""

    merchant: str = Field(min_length=1, max_length=200)
    date: datetime.date
    subtotal: Money | None = None
    tax: Money | None = None
    total: Money
    currency: str = Field(default="CAD", pattern="^[A-Z]{3}$")
    category: Category
    notes: str | None = None
    # Split this expense with the other member of the user's household.
    is_shared: bool = False
    # The percent of the total that the person who paid covers themselves.
    payer_share_percent: Percent = Decimal("50")
    # Or a fixed amount the other person owes. When set, it replaces the percent.
    other_share_amount: Money | None = None

    @model_validator(mode="after")
    def other_share_fits_in_total(self) -> Self:
        """Nobody can owe more than the whole expense."""
        if self.other_share_amount is not None and self.other_share_amount > self.total:
            raise ValueError("other_share_amount cannot be more than the total")
        return self


class ExpenseCreate(ExpenseBase):
    """Request body for creating an expense.

    `was_edited` is not accepted here: the server works it out by comparing
    these values with what the AI extracted from the receipt.
    """

    receipt_id: int | None = None


class ExpenseUpdate(ExpenseBase):
    """Request body for replacing an expense's editable fields."""


class ExpenseRead(ExpenseBase):
    """An expense as returned by the API."""

    # Lets Pydantic build this schema from a SQLAlchemy Expense object.
    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_id: int | None
    was_edited: bool
    created_at: datetime.datetime
