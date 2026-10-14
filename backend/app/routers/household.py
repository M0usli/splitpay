import secrets
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.enums import TransferKind
from app.extraction.schemas import DEFAULT_CURRENCY
from app.models import Expense, Household, Settlement, User
from app.notifications import money, notify
from app.pin import PayingUser
from app.routers.expenses import split_items_or_422
from app.schemas.expense import ExpenseRead
from app.schemas.household import (
    BalanceRead,
    HouseholdCreate,
    HouseholdJoin,
    HouseholdRead,
    MemberBalance,
    MemberRead,
    Payment,
    PersonSplitRead,
    SettlementCreate,
    SettlementRead,
    SharedExpenseRead,
    SplitPreviewRead,
    SplitPreviewRequest,
    WalletPayment,
)
from app.spending import spend
from app.splitting import net_balances, plan_payments
from app.wallet import get_or_create_wallet

router = APIRouter(prefix="/household", tags=["household"])

# A household can be any realistic size. The limit only stops a leaked invite
# code from letting an endless number of accounts join.
MAX_MEMBERS = 20

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
    # two people join at the same moment, the second waits and then counts
    # the members correctly, so the limit cannot be passed.
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
    """Leave the household. Its last member leaving deletes it.

    The balance only counts current members, so anything this user owed or
    was owed stops being counted.
    """
    household = get_household_or_404(db, user)
    user.household_id = None
    db.flush()
    if not get_members(db, household.id):
        db.delete(household)
    db.commit()


def find_shared_expenses(db: Session, household: Household, currency: str | None) -> list[Expense]:
    """Every expense shared with the household, newest first."""
    query = (
        select(Expense)
        .where(Expense.shared_household_id == household.id)
        .order_by(Expense.date.desc(), Expense.id.desc())
    )
    if currency is not None:
        query = query.where(Expense.currency == currency)
    return list(db.scalars(query))


@router.get("/expenses", response_model=list[SharedExpenseRead])
def list_shared_expenses(db: DbSession, user: CurrentUser) -> list[SharedExpenseRead]:
    """The household's shared expenses. Private expenses are never included."""
    household = get_household_or_404(db, user)
    members_by_id = {member.id: member for member in get_members(db, household.id)}

    return [
        SharedExpenseRead(
            **ExpenseRead.model_validate(expense).model_dump(),
            paid_by=MemberRead.model_validate(members_by_id[expense.user_id]),
        )
        for expense in find_shared_expenses(db, household, currency=None)
        # Skip expenses paid by someone who has since left the household.
        if expense.user_id in members_by_id
    ]


@router.get("/balance", response_model=BalanceRead)
def get_balance(
    db: DbSession,
    user: CurrentUser,
    currency: Annotated[str, Query(pattern="^[A-Z]{3}$")] = DEFAULT_CURRENCY,
) -> BalanceRead:
    """Each member's position and the payments that would settle the household.

    Amounts in different currencies cannot be added together, so the balance
    covers one currency at a time (like the Dashboard summary).
    """
    household = get_household_or_404(db, user)
    members = {
        member.id: MemberRead.model_validate(member) for member in get_members(db, household.id)
    }
    expenses = find_shared_expenses(db, household, currency)
    balances = net_balances(members, expenses, find_settlements(db, household, currency))

    return BalanceRead(
        currency=currency,
        shared_expense_count=len(expenses),
        members=[
            MemberBalance(member=members[member_id], net=net) for member_id, net in balances.items()
        ],
        payments=[
            Payment(owed_by=members[owed_by], owed_to=members[owed_to], amount=amount)
            for owed_by, owed_to, amount in plan_payments(balances)
        ],
    )


@router.post("/split-preview", response_model=SplitPreviewRead)
def preview_item_split(
    payload: SplitPreviewRequest, db: DbSession, user: CurrentUser
) -> SplitPreviewRead:
    """Work out an item-by-item split without saving anything.

    The page calls this while the user ticks who each item is for, so the
    arithmetic lives in one place (app/splitting.py) and what is shown is
    exactly what saving the expense will store.
    """
    household = get_household_or_404(db, user)
    members = {member.id: member for member in get_members(db, household.id)}
    tax = payload.tax or Decimal("0")
    people = split_items_or_422(payload.split_items, members, tax, payload.total, user.id)

    return SplitPreviewRead(
        people=[
            PersonSplitRead(
                member=MemberRead.model_validate(members[person]),
                items=split.items,
                tax=split.tax,
                adjustment=split.adjustment,
                amount=split.amount,
            )
            for person, split in sorted(people.items())
        ],
        difference=payload.total - sum(item.price for item in payload.split_items) - tax,
    )


def find_settlements(db: Session, household: Household, currency: str | None) -> list[Settlement]:
    """The household's recorded payments, newest first."""
    query = (
        select(Settlement)
        .where(Settlement.household_id == household.id)
        .order_by(Settlement.created_at.desc(), Settlement.id.desc())
    )
    if currency is not None:
        query = query.where(Settlement.currency == currency)
    return list(db.scalars(query))


def to_settlement_read(settlement: Settlement, members: dict[int, User]) -> SettlementRead:
    return SettlementRead(
        id=settlement.id,
        paid_by=MemberRead.model_validate(members[settlement.from_user_id]),
        paid_to=MemberRead.model_validate(members[settlement.to_user_id]),
        amount=settlement.amount,
        currency=settlement.currency,
        paid_from_wallet=settlement.wallet_transfer_id is not None,
        created_at=settlement.created_at,
    )


@router.post("/settlements", response_model=SettlementRead, status_code=status.HTTP_201_CREATED)
def record_settlement(
    payload: SettlementCreate, db: DbSession, user: CurrentUser
) -> SettlementRead:
    """Record that the logged-in user paid another member back.

    Only the person who paid can record it, so nobody can clear their own
    debt by claiming someone else paid.
    """
    household = get_household_or_404(db, user)
    members = {member.id: member for member in get_members(db, household.id)}
    if payload.to_user_id == user.id or payload.to_user_id not in members:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A payment must go to another member of your household",
        )

    settlement = Settlement(
        household_id=household.id,
        from_user_id=user.id,
        to_user_id=payload.to_user_id,
        amount=payload.amount,
        currency=payload.currency,
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    return to_settlement_read(settlement, members)


@router.post("/pay", response_model=SettlementRead, status_code=status.HTTP_201_CREATED)
def pay_from_wallet(payload: WalletPayment, db: DbSession, user: PayingUser) -> SettlementRead:
    """Pay a housemate from the wallet and record the settlement, together.

    Both changes are in one database transaction: the money moves and the
    debt is marked as paid, or neither happens. There is never a moment
    where the money has left but the debt is still shown.
    """
    household = get_household_or_404(db, user)
    members = {member.id: member for member in get_members(db, household.id)}
    if payload.to_user_id == user.id or payload.to_user_id not in members:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A payment must go to another member of your household",
        )

    wallet = get_or_create_wallet(db, user)
    recipient_wallet = get_or_create_wallet(db, members[payload.to_user_id])
    transfer = spend(
        db,
        user,
        kind=TransferKind.SETTLEMENT,
        destination=recipient_wallet,
        amount=payload.amount,
        idempotency_key=payload.idempotency_key,
        note="Split bill",
    )

    # A repeat of the same request (a double tap) finds the transfer already
    # made, and the settlement that goes with it.
    settlement = db.scalar(select(Settlement).where(Settlement.wallet_transfer_id == transfer.id))
    if settlement is None:
        same_request = (
            transfer.from_wallet_id == wallet.id
            and transfer.to_wallet_id == recipient_wallet.id
            and transfer.amount == payload.amount
            and transfer.kind == TransferKind.SETTLEMENT
        )
        if not same_request:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="This request id was already used for a different transfer",
            )
        settlement = Settlement(
            household_id=household.id,
            from_user_id=user.id,
            to_user_id=payload.to_user_id,
            amount=payload.amount,
            currency=wallet.currency,
            wallet_transfer_id=transfer.id,
        )
        db.add(settlement)
        notify(
            db,
            payload.to_user_id,
            f"{user.email} paid you {money(payload.amount)} for a split bill.",
        )
    db.commit()
    db.refresh(settlement)
    return to_settlement_read(settlement, members)


@router.get("/settlements", response_model=list[SettlementRead])
def list_settlements(db: DbSession, user: CurrentUser) -> list[SettlementRead]:
    household = get_household_or_404(db, user)
    members = {member.id: member for member in get_members(db, household.id)}
    return [
        to_settlement_read(settlement, members)
        for settlement in find_settlements(db, household, currency=None)
        # Skip payments that involve someone who has since left.
        if settlement.from_user_id in members and settlement.to_user_id in members
    ]


@router.delete("/settlements/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_settlement(settlement_id: int, db: DbSession, user: CurrentUser) -> None:
    """Remove a payment recorded by mistake. Only the person who recorded it can."""
    settlement = db.get(Settlement, settlement_id)
    if settlement is None or settlement.from_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payment not found")
    if settlement.wallet_transfer_id is not None:
        # The money really moved, and the ledger is never rewritten. Undoing
        # it means the other person sending the money back.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This was paid from your wallet, so it cannot be undone here. "
            "Ask them to send the money back.",
        )
    db.delete(settlement)
    db.commit()
