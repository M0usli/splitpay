from pydantic import BaseModel, ConfigDict, Field

from app.schemas.expense import ExpenseRead
from app.schemas.stats import Amount


class HouseholdCreate(BaseModel):
    """Request body for creating a household."""

    name: str = Field(min_length=1, max_length=100)


class HouseholdJoin(BaseModel):
    """Request body for joining a household with the code its creator shared."""

    invite_code: str = Field(min_length=1, max_length=16)


class MemberRead(BaseModel):
    """A household member. Only what the other member needs to see."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


class HouseholdRead(BaseModel):
    """The logged-in user's household."""

    id: int
    name: str
    invite_code: str
    members: list[MemberRead]


class SharedExpenseRead(ExpenseRead):
    """A shared expense, with who paid it and how the total is split."""

    paid_by: MemberRead
    payer_part: Amount
    other_part: Amount


class BalanceRead(BaseModel):
    """Who owes whom after counting every shared expense in one currency.

    When nobody owes anything, `amount` is "0.00" and both people are null.
    """

    currency: str
    amount: Amount
    owed_by: MemberRead | None
    owed_to: MemberRead | None
    shared_expense_count: int
