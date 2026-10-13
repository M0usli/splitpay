import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.enums import MoneyRequestStatus, TransferKind
from app.schemas.stats import Amount

# The most that can be moved at once. It is pretend money, but a limit keeps
# typing mistakes (an extra zero) from making nonsense balances.
MAX_TRANSFER = Decimal("10000")

# More than zero, at most the limit, in whole cents.
TransferAmount = Annotated[Decimal, Field(gt=0, le=MAX_TRANSFER, max_digits=12, decimal_places=2)]

# Made up by the app for each action the user starts (a UUID works well).
IdempotencyKey = Annotated[str, Field(min_length=8, max_length=64)]


class WalletRead(BaseModel):
    """The logged-in user's wallet."""

    balance: Amount
    currency: str


class LimitsRead(BaseModel):
    """How much the logged-in user may send per day, and how much is left today."""

    # "verified" once the identity check is passed; it has the higher limit.
    level: Literal["unverified", "verified"]
    daily_limit: Amount
    sent_today: Amount
    remaining: Amount


class TopUpRequest(BaseModel):
    """Request body for adding pretend money to the wallet."""

    amount: TransferAmount
    idempotency_key: IdempotencyKey


class SendRequest(BaseModel):
    """Request body for sending money to another user."""

    to_email: EmailStr
    amount: TransferAmount
    note: str | None = Field(default=None, max_length=200)
    idempotency_key: IdempotencyKey

    @field_validator("to_email")
    @classmethod
    def lowercase_email(cls, email: str) -> str:
        return email.lower()


class TransactionRead(BaseModel):
    """One line of the wallet's history, seen from the logged-in user's side."""

    id: int
    kind: TransferKind
    # "in" when the money came into this wallet, "out" when it left.
    direction: Literal["in", "out"]
    amount: Amount
    # The other person's email. Empty for a top-up, which has no other person.
    counterparty: str | None
    note: str | None
    created_at: datetime.datetime


class TransferResult(BaseModel):
    """What a top-up or a send returns: the new line of history and the new balance."""

    transaction: TransactionRead
    balance: Amount


class MoneyRequestCreate(BaseModel):
    """Request body for asking another user for money."""

    to_email: EmailStr
    amount: TransferAmount
    note: str | None = Field(default=None, max_length=200)

    @field_validator("to_email")
    @classmethod
    def lowercase_email(cls, email: str) -> str:
        return email.lower()


class MoneyRequestPay(BaseModel):
    """Request body for paying a request. The id makes a double tap pay once."""

    idempotency_key: IdempotencyKey


class MoneyRequestRead(BaseModel):
    """A request for money, seen from the logged-in user's side."""

    id: int
    # "incoming": someone asked me. "outgoing": I asked someone.
    direction: Literal["incoming", "outgoing"]
    # The other person's email.
    counterparty: str
    amount: Amount
    note: str | None
    status: MoneyRequestStatus
    created_at: datetime.datetime
