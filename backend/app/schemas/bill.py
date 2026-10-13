import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.schemas.stats import Amount
from app.schemas.wallet import IdempotencyKey, TransferAmount

# Letters, digits and dashes, as printed on a bill. Spaces around it are removed.
AccountNumber = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_upper=True,
        min_length=4,
        max_length=20,
        pattern=r"^[A-Za-z0-9-]+$",
    ),
]


class BillerRead(BaseModel):
    """A company that can be paid."""

    code: str
    name: str
    kind: str


class SavedBillerCreate(BaseModel):
    biller_code: str
    account_number: AccountNumber


class SavedBillerRead(BaseModel):
    id: int
    biller: BillerRead
    account_number: str


class BillPay(BaseModel):
    """Request body for paying a bill to one of the user's saved billers."""

    saved_biller_id: int
    amount: TransferAmount
    idempotency_key: IdempotencyKey


class BillPaymentRead(BaseModel):
    """The receipt for one bill payment."""

    id: int
    # A short code to quote to the company, for example "BP-000042".
    reference: str
    biller: BillerRead
    account_number: str
    amount: Amount
    currency: str
    # The expense made for this payment. Empty if the user deleted it since.
    expense_id: int | None
    created_at: datetime.datetime
