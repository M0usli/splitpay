import datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, Field, model_validator

from app.enums import Category

DEFAULT_CURRENCY = "CAD"

# Same rule as the expense schema: non-negative, at most 2 decimal places.
ExtractedAmount = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]

# A line on a receipt can be negative (a discount or a coupon), so this one
# has no "not below zero" rule.
LinePrice = Annotated[Decimal, Field(max_digits=10, decimal_places=2)]

# Far more lines than any real receipt; it only stops a runaway reply.
MAX_ITEMS = 300


class ExtractedItem(BaseModel):
    """One line of a receipt: something bought, or a discount."""

    name: str = Field(min_length=1, max_length=200)
    # How many units the line covers, when the receipt prints it (e.g. "2 @ 1.99").
    quantity: int | None = Field(ge=1)
    # The price of the whole line, not of one unit. Negative for a discount.
    price: LinePrice
    # Whether sales tax was charged on this line. None means the receipt does not say.
    is_taxable: bool | None


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
    # Every line of the receipt, in the order printed. Empty when none can be read.
    items: list[ExtractedItem] = Field(max_length=MAX_ITEMS)

    @model_validator(mode="before")
    @classmethod
    def items_default_to_empty(cls, data: Any) -> Any:
        """Receipts saved before items were extracted have no "items" key.

        The field has no default on purpose: a default would make it optional
        in the schema sent to the model, and the model could then leave it
        out. Filling it in here keeps it required for the model while old
        saved receipts still load.
        """
        if isinstance(data, dict) and "items" not in data:
            return {**data, "items": []}
        return data
