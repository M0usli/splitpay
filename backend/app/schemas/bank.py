import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.enums import BankTransactionStatus, Category
from app.schemas.stats import Amount


class BankConnectionRead(BaseModel):
    """A connected bank. The access token is never included."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    institution_name: str
    created_at: datetime.datetime


class BankStatus(BaseModel):
    """Whether the bank feature is set up, and the user's connected banks."""

    # False when the Plaid sandbox keys are missing from .env.
    configured: bool
    connections: list[BankConnectionRead]


class LinkToken(BaseModel):
    """The short-lived token that opens Plaid's "choose your bank" window."""

    link_token: str


class BankConnectionCreate(BaseModel):
    """Request body after the user finished choosing a bank in Plaid's window."""

    # Plaid gives this to the browser. It is useless by itself: the backend
    # swaps it, together with the secret key, for the real access token.
    public_token: str = Field(min_length=1, max_length=500)
    institution_name: str = Field(min_length=1, max_length=200)


class SyncSummary(BaseModel):
    """What an import did."""

    imported: int
    removed: int


class BankTransactionRead(BaseModel):
    """An imported transaction, as shown in the review list."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_id: int
    name: str
    amount: Amount
    currency: str
    date: datetime.date
    category: Category
    status: BankTransactionStatus
    expense_id: int | None


class BankTransactionAdd(BaseModel):
    """Request body for turning an imported transaction into an expense."""

    # Left out, the suggested category is used.
    category: Category | None = None
