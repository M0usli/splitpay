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
    """A household member. Only what the other members need to see."""

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
    """A shared expense as the whole household sees it, with who paid."""

    paid_by: MemberRead


class MemberBalance(BaseModel):
    """One member's position: positive is owed money, negative owes money."""

    member: MemberRead
    net: Amount


class Payment(BaseModel):
    """A payment that would help settle the household: `owed_by` pays `owed_to`."""

    owed_by: MemberRead
    owed_to: MemberRead
    amount: Amount


class BalanceRead(BaseModel):
    """Where the household stands after counting every shared expense in one currency.

    `payments` is the shortest list of payments that brings everyone to zero.
    It is empty when nobody owes anything.
    """

    currency: str
    shared_expense_count: int
    members: list[MemberBalance]
    payments: list[Payment]
