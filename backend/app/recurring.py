"""Working out when a monthly recurring cost is due.

Plain functions with no database or web code, so they are easy to test.
"""

import datetime

# A recurring cost is paid on day 1 to 28. Days 29 to 31 do not exist in
# every month, and "the 31st" in February would need a rule of its own.
MAX_DAY_OF_MONTH = 28

# If the app was not opened for a long time, catch up on at most this many
# months, so one visit cannot create an endless list of expenses.
MAX_CATCH_UP_MONTHS = 12


def month_label(date: datetime.date) -> str:
    """The month a date is in, as "YYYY-MM"."""
    return f"{date.year:04d}-{date.month:02d}"


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def due_dates(
    day_of_month: int,
    start_date: datetime.date,
    today: datetime.date,
    months_already_made: set[str],
) -> list[datetime.date]:
    """The dates an expense should exist for but does not yet, oldest first.

    One date per month, on `day_of_month`, from `start_date` up to and
    including `today`, leaving out months that already have their expense.
    """
    dates = []
    year, month = start_date.year, start_date.month
    while (year, month) <= (today.year, today.month):
        date = datetime.date(year, month, day_of_month)
        if start_date <= date <= today and month_label(date) not in months_already_made:
            dates.append(date)
        year, month = next_month(year, month)
    return dates[-MAX_CATCH_UP_MONTHS:]


def next_occurrence(
    day_of_month: int, start_date: datetime.date, today: datetime.date
) -> datetime.date:
    """The first date after `today`, and not before `start_date`, it is due."""
    earliest = max(start_date, today + datetime.timedelta(days=1))
    year, month = earliest.year, earliest.month
    date = datetime.date(year, month, day_of_month)
    if date < earliest:
        year, month = next_month(year, month)
        date = datetime.date(year, month, day_of_month)
    return date
