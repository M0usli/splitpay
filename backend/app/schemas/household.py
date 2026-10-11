import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.expense import ExpenseRead, Money, SplitItem
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


class SplitPreviewRequest(BaseModel):
    """Request body for trying out an item-by-item split before saving it."""

    split_items: list[SplitItem] = Field(min_length=1, max_length=300)
    tax: Money | None = None
    total: Money


class PersonSplitRead(BaseModel):
    """What one member would pay, and what it is made of."""

    member: MemberRead
    items: Amount
    tax: Amount
    adjustment: Amount
    amount: Amount


class SplitPreviewRead(BaseModel):
    """The result of an item-by-item split. The amounts add up to the total."""

    people: list[PersonSplitRead]
    # total - (items + tax): money on the receipt that no line accounts for.
    difference: Amount


class SettlementCreate(BaseModel):
    """Request body for recording that the logged-in user paid a member back."""

    to_user_id: int
    # gt=0: a payment of nothing is not a payment.
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(default="CAD", pattern="^[A-Z]{3}$")


class SettlementRead(BaseModel):
    """A recorded payment between two members."""

    id: int
    paid_by: MemberRead
    paid_to: MemberRead
    amount: Amount
    currency: str
    created_at: datetime.datetime


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
