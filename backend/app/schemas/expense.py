import datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.enums import Category

# A non-negative amount with at most 2 decimal places. Sent as a string in
# JSON (e.g. "12.50") so it never passes through a float.
Money = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]


class Share(BaseModel):
    """One person's part of a shared expense."""

    model_config = ConfigDict(from_attributes=True)

    user_id: int
    amount: Money


class SplitItem(BaseModel):
    """One line of a receipt and the household members who share it."""

    name: str = Field(min_length=1, max_length=200)
    # Negative for a discount.
    price: Decimal = Field(max_digits=10, decimal_places=2)
    is_taxable: bool = False
    # The ids of the people this line is for. It is split equally among them.
    shared_by: list[int] = Field(min_length=1)


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


class ExpenseWrite(ExpenseBase):
    """Fields for creating or changing an expense, including how it is shared."""

    # Share this expense with the user's household.
    is_shared: bool = False
    # Each person's part. Leave it out to split the total equally among all
    # members of the household. The parts must add up to the total.
    shares: list[Share] | None = None
    # Or split a receipt item by item: each line says who it is for, and the
    # server works out the parts (including tax). When given, `shares` is ignored.
    split_items: list[SplitItem] | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def shares_add_up_to_the_total(self) -> Self:
        if not self.is_shared or self.shares is None or self.split_items is not None:
            return self
        user_ids = [share.user_id for share in self.shares]
        if len(user_ids) != len(set(user_ids)):
            raise ValueError("each person can have only one share")
        if sum(share.amount for share in self.shares) != self.total:
            raise ValueError("the shares must add up to the total")
        return self


class ExpenseCreate(ExpenseWrite):
    """Request body for creating an expense.

    `was_edited` is not accepted here: the server works it out by comparing
    these values with what the AI extracted from the receipt.
    """

    receipt_id: int | None = None


class ExpenseUpdate(ExpenseWrite):
    """Request body for replacing an expense's editable fields."""


class ExpenseRead(ExpenseBase):
    """An expense as returned by the API."""

    # Lets Pydantic build this schema from a SQLAlchemy Expense object.
    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_id: int | None
    was_edited: bool
    created_at: datetime.datetime
    is_shared: bool
    # Empty for a private expense.
    shares: list[Share]
    # The item-by-item choices, when the expense was split that way.
    split_items: list[SplitItem] | None
