"""Helpers for working with months written as "YYYY-MM"."""

import datetime
from typing import Annotated

from fastapi import Query

# A query parameter such as ?month=2026-10. Endpoints share this definition so
# they all validate months the same way.
MonthQuery = Annotated[
    str | None,
    Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="Month as YYYY-MM"),
]


def month_range(month: str) -> tuple[datetime.date, datetime.date]:
    """Turn "2026-10" into (first day of that month, first day of the next month)."""
    year, month_number = (int(part) for part in month.split("-"))
    start = datetime.date(year, month_number, 1)
    if month_number == 12:
        end = datetime.date(year + 1, 1, 1)
    else:
        end = datetime.date(year, month_number + 1, 1)
    return start, end


def last_months(month: str, count: int) -> list[str]:
    """The `count` months ending with `month`, oldest first.

    last_months("2026-02", 3) -> ["2025-12", "2026-01", "2026-02"]
    """
    year, month_number = (int(part) for part in month.split("-"))
    months = []
    for _ in range(count):
        months.append(f"{year:04d}-{month_number:02d}")
        month_number -= 1
        if month_number == 0:
            month_number = 12
            year -= 1
    months.reverse()
    return months
