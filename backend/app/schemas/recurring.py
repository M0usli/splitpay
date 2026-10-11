import datetime
from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.enums import Category
from app.recurring import MAX_DAY_OF_MONTH
from app.schemas.expense import Money, Share


class RecurringWrite(BaseModel):
    """Request body for creating or changing a recurring cost."""

    merchant: str = Field(min_length=1, max_length=200)
    total: Money
    currency: str = Field(default="CAD", pattern="^[A-Z]{3}$")
    category: Category
    notes: str | None = None
    day_of_month: int = Field(ge=1, le=MAX_DAY_OF_MONTH)
    # The first date an expense may be made for. Left out, it is today when
    # creating, and stays as it was when changing.
    start_date: datetime.date | None = None
    is_active: bool = True
    # Sharing works as it does for an expense: leave `shares` out to split
    # equally among the household each month.
    is_shared: bool = False
    shares: list[Share] | None = None

    @model_validator(mode="after")
    def shares_add_up_to_the_total(self) -> Self:
        if not self.is_shared or self.shares is None:
            return self
        user_ids = [share.user_id for share in self.shares]
        if len(user_ids) != len(set(user_ids)):
            raise ValueError("each person can have only one share")
        if sum(share.amount for share in self.shares) != self.total:
            raise ValueError("the shares must add up to the total")
        return self


class RecurringRead(BaseModel):
    """A recurring cost as returned by the API."""

    id: int
    merchant: str
    total: Money
    currency: str
    category: Category
    notes: str | None
    day_of_month: int
    start_date: datetime.date
    is_active: bool
    is_shared: bool
    shares: list[Share] | None
    # When the next expense will be made. None for a stopped cost.
    next_date: datetime.date | None
    created_at: datetime.datetime
