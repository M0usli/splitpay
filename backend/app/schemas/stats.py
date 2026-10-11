from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel

from app.enums import Category

# A sum of money, always shown with two decimal places ("0.00", not "0").
Amount = Annotated[Decimal, AfterValidator(lambda value: value.quantize(Decimal("0.01")))]


class CategoryTotal(BaseModel):
    category: Category
    total: Amount


class MonthlyTotal(BaseModel):
    month: str  # "YYYY-MM"
    total: Amount


class MerchantTotal(BaseModel):
    merchant: str
    total: Amount
    expense_count: int


class StatsSummary(BaseModel):
    """Everything the Dashboard shows, for one month and one currency."""

    month: str  # "YYYY-MM"
    currency: str
    month_total: Amount
    expense_count: int
    # Spending in `month`, largest category first.
    by_category: list[CategoryTotal]
    # The six months ending with `month`, oldest first. Months with no spending are 0.
    monthly_totals: list[MonthlyTotal]
    # The five merchants with the highest spending over those six months.
    top_merchants: list[MerchantTotal]
