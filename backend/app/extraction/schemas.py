import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field

from app.enums import Category

DEFAULT_CURRENCY = "CAD"

# Same rule as the expense schema: non-negative, at most 2 decimal places.
ExtractedAmount = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]


class ExtractedFields(BaseModel):
    """What the AI model read from a receipt. None means "not found".

    This class does two jobs: its JSON schema is sent to the model to fix the
    shape of the reply, and the reply is then validated against it.
    """

    merchant: str | None = Field(max_length=200)
    date: datetime.date | None
    subtotal: ExtractedAmount | None
    tax: ExtractedAmount | None
    total: ExtractedAmount | None
    currency: str | None = Field(pattern="^[A-Z]{3}$")
    category: Category | None
