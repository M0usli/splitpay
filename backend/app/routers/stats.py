import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import desc, func, select

from app.database import DbSession
from app.dates import MonthQuery, last_months, month_range
from app.extraction.schemas import DEFAULT_CURRENCY
from app.models import Expense
from app.schemas.stats import CategoryTotal, MerchantTotal, MonthlyTotal, StatsSummary

router = APIRouter(prefix="/stats", tags=["stats"])

MONTHS_IN_TREND = 6
TOP_MERCHANT_COUNT = 5


@router.get("/summary", response_model=StatsSummary)
def get_summary(
    db: DbSession,
    month: MonthQuery = None,
    currency: Annotated[str, Query(pattern="^[A-Z]{3}$")] = DEFAULT_CURRENCY,
) -> StatsSummary:
    """Spending summary for the Dashboard.

    `month` defaults to the current month on the server's clock (UTC). Amounts
    in different currencies cannot be added together, so the summary covers
    one currency at a time.

    The adding-up is done by the database (SUM and GROUP BY), not in Python.
    """
    if month is None:
        month = datetime.date.today().strftime("%Y-%m")

    month_start, month_end = month_range(month)
    months = last_months(month, MONTHS_IN_TREND)
    trend_start, _ = month_range(months[0])

    in_month = (
        Expense.date >= month_start,
        Expense.date < month_end,
        Expense.currency == currency,
    )
    in_trend = (
        Expense.date >= trend_start,
        Expense.date < month_end,
        Expense.currency == currency,
    )

    # 1. This month's total and number of expenses. COALESCE turns "no rows" into 0.
    month_total, expense_count = db.execute(
        select(func.coalesce(func.sum(Expense.total), 0), func.count()).where(*in_month)
    ).one()

    # 2. This month's total per category, largest first.
    category_rows = db.execute(
        select(Expense.category, func.sum(Expense.total).label("total"))
        .where(*in_month)
        .group_by(Expense.category)
        .order_by(desc("total"), Expense.category)
    ).all()

    # 3. Total per month over the last six months. The database only returns
    #    months that have expenses, so the empty ones are filled in with 0.
    month_label = func.to_char(Expense.date, "YYYY-MM")
    totals_by_month = dict(
        db.execute(
            select(month_label, func.sum(Expense.total)).where(*in_trend).group_by(month_label)
        ).all()
    )

    # 4. Top merchants over the same six months. Grouping ignores case and
    #    surrounding spaces, so "FRESHCO" and "FreshCo" count as one merchant.
    merchant_key = func.lower(func.trim(Expense.merchant))
    merchant_rows = db.execute(
        select(
            func.max(Expense.merchant),
            func.sum(Expense.total).label("total"),
            func.count(),
        )
        .where(*in_trend)
        .group_by(merchant_key)
        .order_by(desc("total"), merchant_key)
        .limit(TOP_MERCHANT_COUNT)
    ).all()

    return StatsSummary(
        month=month,
        currency=currency,
        month_total=month_total,
        expense_count=expense_count,
        by_category=[
            CategoryTotal(category=category, total=total) for category, total in category_rows
        ],
        monthly_totals=[
            MonthlyTotal(month=label, total=totals_by_month.get(label, Decimal("0")))
            for label in months
        ],
        top_merchants=[
            MerchantTotal(merchant=merchant, total=total, expense_count=count)
            for merchant, total, count in merchant_rows
        ],
    )
