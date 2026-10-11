import csv
import io

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.dates import MonthQuery, month_range
from app.enums import Category
from app.extraction.schemas import DEFAULT_CURRENCY, ExtractedFields
from app.models import Expense, Receipt, User
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate

router = APIRouter(prefix="/expenses", tags=["expenses"])

# Fields the AI fills in from a receipt. An expense whose saved values differ
# from the AI's in any of these counts as corrected by the user (was_edited).
EXTRACTED_FIELDS = ("merchant", "date", "subtotal", "tax", "total", "currency", "category")

CSV_COLUMNS = (
    "date",
    "merchant",
    "category",
    "subtotal",
    "tax",
    "total",
    "currency",
    "notes",
    "source",
    "edited",
)


def get_expense_or_404(db: Session, user: User, expense_id: int) -> Expense:
    """Find one of the user's own expenses.

    Someone else's expense gives the same 404 as one that does not exist, so
    the answer never reveals which ids are in use.
    """
    expense = db.get(Expense, expense_id)
    if expense is None or expense.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return expense


def differs_from_extraction(values: dict, receipt: Receipt) -> bool:
    """Return True if the user changed any field the AI extracted from this receipt."""
    if receipt.extracted_fields is None:
        return False
    extracted = ExtractedFields.model_validate(receipt.extracted_fields).model_dump()
    # Receipts rarely print a currency, so a missing one means the app default.
    extracted["currency"] = extracted["currency"] or DEFAULT_CURRENCY
    return any(values[field] != extracted[field] for field in EXTRACTED_FIELDS)


@router.post("", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(payload: ExpenseCreate, db: DbSession, user: CurrentUser) -> Expense:
    values = payload.model_dump()
    was_edited = False
    if payload.receipt_id is not None:
        receipt = db.get(Receipt, payload.receipt_id)
        if receipt is None or receipt.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Receipt not found")
        was_edited = differs_from_extraction(values, receipt)

    # The owner comes from the login session, never from the request body.
    expense = Expense(**values, was_edited=was_edited, user_id=user.id)
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


def find_expenses(
    db: Session, user: User, month: str | None, category: Category | None
) -> list[Expense]:
    """The user's expenses, newest first, optionally limited to one month and/or category."""
    query = (
        select(Expense)
        .where(Expense.user_id == user.id)
        .order_by(Expense.date.desc(), Expense.id.desc())
    )
    if month is not None:
        start, end = month_range(month)
        query = query.where(Expense.date >= start, Expense.date < end)
    if category is not None:
        query = query.where(Expense.category == category)
    return list(db.scalars(query))


def protect_spreadsheet_cell(text: str) -> str:
    """Stop a spreadsheet from running a text cell as a formula.

    Excel and Google Sheets treat a cell starting with = + - or @ as a
    formula. A merchant name read from a receipt could start that way, so we
    put an apostrophe in front, which makes the spreadsheet show it as text.
    """
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


@router.get("", response_model=list[ExpenseRead])
def list_expenses(
    db: DbSession, user: CurrentUser, month: MonthQuery = None, category: Category | None = None
) -> list[Expense]:
    """List expenses, newest first, optionally filtered by month and category."""
    return find_expenses(db, user, month, category)


# This route must come before "/{expense_id}". Routes are tried in order, and
# otherwise "export.csv" would be taken as an expense id.
@router.get(
    "/export.csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
def export_expenses_csv(
    db: DbSession, user: CurrentUser, month: MonthQuery = None, category: Category | None = None
) -> Response:
    """Download expenses as a CSV file. Takes the same filters as the list."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for expense in find_expenses(db, user, month, category):
        writer.writerow(
            [
                expense.date.isoformat(),
                protect_spreadsheet_cell(expense.merchant),
                expense.category.value,
                expense.subtotal if expense.subtotal is not None else "",
                expense.tax if expense.tax is not None else "",
                expense.total,
                expense.currency,
                protect_spreadsheet_cell(expense.notes or ""),
                "receipt" if expense.receipt_id is not None else "manual",
                "yes" if expense.was_edited else "no",
            ]
        )

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        # "attachment" tells the browser to download the file, not display it.
        headers={"Content-Disposition": 'attachment; filename="expenses.csv"'},
    )


@router.get("/{expense_id}", response_model=ExpenseRead)
def get_expense(expense_id: int, db: DbSession, user: CurrentUser) -> Expense:
    return get_expense_or_404(db, user, expense_id)


@router.put("/{expense_id}", response_model=ExpenseRead)
def update_expense(
    expense_id: int, payload: ExpenseUpdate, db: DbSession, user: CurrentUser
) -> Expense:
    expense = get_expense_or_404(db, user, expense_id)
    new_values = payload.model_dump()

    if expense.receipt_id is not None:
        receipt = db.get(Receipt, expense.receipt_id)
        if receipt is not None:
            expense.was_edited = differs_from_extraction(new_values, receipt)

    for field, value in new_values.items():
        setattr(expense, field, value)
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(expense_id: int, db: DbSession, user: CurrentUser) -> None:
    expense = get_expense_or_404(db, user, expense_id)
    db.delete(expense)
    db.commit()
