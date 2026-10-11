import datetime
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.models import Expense, RecurringExpense, User
from app.recurring import due_dates, month_label, next_occurrence
from app.routers.expenses import store_shares, work_out_shares
from app.schemas.expense import ExpenseCreate, ExpenseRead, Share
from app.schemas.recurring import RecurringRead, RecurringWrite

router = APIRouter(prefix="/recurring", tags=["recurring"])

logger = logging.getLogger(__name__)


def get_today() -> datetime.date:
    """Today's date on the server. A dependency, so tests can choose the day."""
    return datetime.date.today()


Today = Annotated[datetime.date, Depends(get_today)]


def get_recurring_or_404(db: Session, user: User, recurring_id: int) -> RecurringExpense:
    recurring = db.get(RecurringExpense, recurring_id)
    if recurring is None or recurring.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Recurring cost not found")
    return recurring


def to_read(recurring: RecurringExpense, today: datetime.date) -> RecurringRead:
    return RecurringRead(
        id=recurring.id,
        merchant=recurring.merchant,
        total=recurring.total,
        currency=recurring.currency,
        category=recurring.category,
        notes=recurring.notes,
        day_of_month=recurring.day_of_month,
        start_date=recurring.start_date,
        is_active=recurring.is_active,
        is_shared=recurring.is_shared,
        shares=[Share.model_validate(share) for share in recurring.shares]
        if recurring.shares is not None
        else None,
        next_date=next_occurrence(recurring.day_of_month, recurring.start_date, today)
        if recurring.is_active
        else None,
        created_at=recurring.created_at,
    )


def check_sharing(db: Session, user: User, payload: RecurringWrite) -> None:
    """Refuse sharing that could not work, using the same rules as an expense."""
    as_expense = ExpenseCreate(
        merchant=payload.merchant,
        date=datetime.date.today(),
        total=payload.total,
        category=payload.category,
        is_shared=payload.is_shared,
        shares=payload.shares,
    )
    work_out_shares(db, user, as_expense)


def apply_payload(recurring: RecurringExpense, payload: RecurringWrite) -> None:
    for field in ("merchant", "total", "currency", "category", "notes", "day_of_month"):
        setattr(recurring, field, getattr(payload, field))
    recurring.is_active = payload.is_active
    recurring.is_shared = payload.is_shared
    # mode="json" turns the Decimal amounts into strings so they fit in a JSON column.
    recurring.shares = (
        [share.model_dump(mode="json") for share in payload.shares]
        if payload.is_shared and payload.shares is not None
        else None
    )


@router.post("", response_model=RecurringRead, status_code=status.HTTP_201_CREATED)
def create_recurring(
    payload: RecurringWrite, db: DbSession, user: CurrentUser, today: Today
) -> RecurringRead:
    check_sharing(db, user, payload)
    recurring = RecurringExpense(user_id=user.id, start_date=payload.start_date or today)
    apply_payload(recurring, payload)
    db.add(recurring)
    db.commit()
    db.refresh(recurring)
    return to_read(recurring, today)


@router.get("", response_model=list[RecurringRead])
def list_recurring(db: DbSession, user: CurrentUser, today: Today) -> list[RecurringRead]:
    """The user's recurring costs: active ones first, then by day of the month."""
    rows = db.scalars(
        select(RecurringExpense)
        .where(RecurringExpense.user_id == user.id)
        .order_by(
            RecurringExpense.is_active.desc(), RecurringExpense.day_of_month, RecurringExpense.id
        )
    )
    return [to_read(recurring, today) for recurring in rows]


def make_expense(
    db: Session, user: User, recurring: RecurringExpense, date: datetime.date
) -> Expense | None:
    """Make the expense for one month. Returns None if it already exists."""
    payload = ExpenseCreate(
        merchant=recurring.merchant,
        date=date,
        total=recurring.total,
        currency=recurring.currency,
        category=recurring.category,
        notes=recurring.notes,
        is_shared=recurring.is_shared,
        shares=recurring.shares,
    )
    try:
        parts = work_out_shares(db, user, payload)
    except HTTPException:
        # The saved sharing no longer fits, for example a roommate moved out
        # or the user left the household. The cost is still real, so it is
        # recorded as a private expense rather than dropped.
        logger.warning("Recurring cost %s could not be shared; saved as private", recurring.id)
        parts = None

    expense = Expense(
        user_id=user.id,
        merchant=recurring.merchant,
        date=date,
        total=recurring.total,
        currency=recurring.currency,
        category=recurring.category,
        notes=recurring.notes,
        recurring_id=recurring.id,
        recurring_month=month_label(date),
    )
    try:
        # A savepoint: if this one INSERT fails, only it is undone, and the
        # expenses already made in this request are kept.
        with db.begin_nested():
            db.add(expense)
            store_shares(db, user, expense, parts)
    except IntegrityError:
        # Another request made this month's expense a moment ago. The unique
        # rule on (recurring_id, recurring_month) refused the second one.
        return None
    return expense


@router.post("/run", response_model=list[ExpenseRead])
def run_recurring(db: DbSession, user: CurrentUser, today: Today) -> list[Expense]:
    """Make every expense that is due and does not exist yet.

    The app calls this when it opens. Calling it again changes nothing: each
    recurring cost gets at most one expense per month.
    """
    created = []
    recurring_costs = db.scalars(
        select(RecurringExpense).where(
            RecurringExpense.user_id == user.id, RecurringExpense.is_active
        )
    ).all()
    for recurring in recurring_costs:
        months_already_made = set(
            db.scalars(select(Expense.recurring_month).where(Expense.recurring_id == recurring.id))
        )
        dates = due_dates(recurring.day_of_month, recurring.start_date, today, months_already_made)
        for date in dates:
            expense = make_expense(db, user, recurring, date)
            if expense is not None:
                created.append(expense)
    db.commit()
    return created


@router.put("/{recurring_id}", response_model=RecurringRead)
def update_recurring(
    recurring_id: int, payload: RecurringWrite, db: DbSession, user: CurrentUser, today: Today
) -> RecurringRead:
    """Change a recurring cost, or stop it with `is_active: false`.

    Expenses already made are not changed.
    """
    recurring = get_recurring_or_404(db, user, recurring_id)
    check_sharing(db, user, payload)
    apply_payload(recurring, payload)
    if payload.start_date is not None:
        recurring.start_date = payload.start_date
    db.commit()
    db.refresh(recurring)
    return to_read(recurring, today)


@router.delete("/{recurring_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(recurring_id: int, db: DbSession, user: CurrentUser) -> None:
    """Delete a recurring cost. The expenses it already made are kept."""
    recurring = get_recurring_or_404(db, user, recurring_id)
    db.delete(recurring)
    db.commit()
