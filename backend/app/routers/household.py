import secrets
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.extraction.schemas import DEFAULT_CURRENCY
from app.models import Expense, Household, User
from app.schemas.expense import ExpenseRead
from app.schemas.household import (
    BalanceRead,
    HouseholdCreate,
    HouseholdJoin,
    HouseholdRead,
    MemberRead,
    SharedExpenseRead,
)
from app.splitting import amount_owed_to, split_total

router = APIRouter(prefix="/household", tags=["household"])

MAX_MEMBERS = 2

# Letters and digits that are hard to mix up when read aloud or typed:
# no 0/O and no 1/I/L.
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
INVITE_LENGTH = 8


def new_invite_code() -> str:
    # `secrets` gives random values that cannot be predicted, unlike `random`.
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))


def get_members(db: Session, household_id: int) -> list[User]:
    """The household's members, in the order they signed up."""
    return list(db.scalars(select(User).where(User.household_id == household_id).order_by(User.id)))


def get_household_or_404(db: Session, user: User) -> Household:
    household = db.get(Household, user.household_id) if user.household_id is not None else None
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="You are not in a household")
    return household


def to_household_read(db: Session, household: Household) -> HouseholdRead:
    return HouseholdRead(
        id=household.id,
        name=household.name,
        invite_code=household.invite_code,
        members=[MemberRead.model_validate(member) for member in get_members(db, household.id)],
    )


def require_no_household(user: User) -> None:
    if user.household_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You are already in a household")


@router.post("", response_model=HouseholdRead, status_code=status.HTTP_201_CREATED)
def create_household(payload: HouseholdCreate, db: DbSession, user: CurrentUser) -> HouseholdRead:
    """Create a household. The creator becomes its first member."""
    require_no_household(user)
    household = Household(name=payload.name.strip(), invite_code=new_invite_code())
    db.add(household)
    # flush sends the INSERT so the household gets its id, without committing yet.
    db.flush()
    user.household_id = household.id
    db.commit()
    return to_household_read(db, household)


@router.get("", response_model=HouseholdRead)
def get_household(db: DbSession, user: CurrentUser) -> HouseholdRead:
    return to_household_read(db, get_household_or_404(db, user))


@router.post("/join", response_model=HouseholdRead)
def join_household(payload: HouseholdJoin, db: DbSession, user: CurrentUser) -> HouseholdRead:
    """Join the household that has this invite code."""
    require_no_household(user)
    # with_for_update locks the household row until this request commits. If
    # two people join at the same moment, the second waits and then sees the
    # household is full, instead of both getting in.
    household = db.scalar(
        select(Household)
        .where(Household.invite_code == payload.invite_code.strip().upper())
        .with_for_update()
    )
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No household has this invite code")
    if len(get_members(db, household.id)) >= MAX_MEMBERS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This household is already full")

    user.household_id = household.id
    db.commit()
    return to_household_read(db, household)


@router.post("/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_household(db: DbSession, user: CurrentUser) -> None:
    """Leave the household. Its last member leaving deletes it."""
    household = get_household_or_404(db, user)
    user.household_id = None
    db.flush()
    if not get_members(db, household.id):
        db.delete(household)
    db.commit()


def find_shared_expenses(db: Session, members: list[User], currency: str | None) -> list[Expense]:
    """Every expense the members marked as shared, newest first."""
    query = (
        select(Expense)
        .where(Expense.is_shared, Expense.user_id.in_([member.id for member in members]))
        .order_by(Expense.date.desc(), Expense.id.desc())
    )
    if currency is not None:
        query = query.where(Expense.currency == currency)
    return list(db.scalars(query))


@router.get("/expenses", response_model=list[SharedExpenseRead])
def list_shared_expenses(db: DbSession, user: CurrentUser) -> list[SharedExpenseRead]:
    """The shared expenses of both members. Unshared expenses stay private."""
    household = get_household_or_404(db, user)
    members = get_members(db, household.id)
    members_by_id = {member.id: member for member in members}

    result = []
    for expense in find_shared_expenses(db, members, currency=None):
        payer_part, other_part = split_total(
            expense.total, expense.payer_share_percent, expense.other_share_amount
        )
        result.append(
            SharedExpenseRead(
                # The usual expense fields, plus the three about the split.
                **ExpenseRead.model_validate(expense).model_dump(),
                paid_by=MemberRead.model_validate(members_by_id[expense.user_id]),
                payer_part=payer_part,
                other_part=other_part,
            )
        )
    return result


@router.get("/balance", response_model=BalanceRead)
def get_balance(
    db: DbSession,
    user: CurrentUser,
    currency: Annotated[str, Query(pattern="^[A-Z]{3}$")] = DEFAULT_CURRENCY,
) -> BalanceRead:
    """Who owes whom, counting every shared expense in one currency.

    Amounts in different currencies cannot be added together, so the balance
    covers one currency at a time (like the Dashboard summary).
    """
    household = get_household_or_404(db, user)
    members = get_members(db, household.id)
    expenses = find_shared_expenses(db, members, currency)

    settled = BalanceRead(
        currency=currency,
        amount=Decimal("0"),
        owed_by=None,
        owed_to=None,
        shared_expense_count=len(expenses),
    )
    # Alone in the household there is nobody to owe yet.
    if len(members) < MAX_MEMBERS:
        return settled

    first, second = members
    owed_to_first = amount_owed_to(first.id, expenses)
    if owed_to_first == 0:
        return settled

    owed_to, owed_by = (first, second) if owed_to_first > 0 else (second, first)
    return settled.model_copy(
        update={
            "amount": abs(owed_to_first),
            "owed_by": MemberRead.model_validate(owed_by),
            "owed_to": MemberRead.model_validate(owed_to),
        }
    )
