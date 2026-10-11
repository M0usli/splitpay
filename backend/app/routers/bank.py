from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.bank import BankClientDep, BankError, BankTransactionData
from app.bank.categories import suggest_category
from app.config import SettingsDep
from app.database import DbSession
from app.enums import BankTransactionStatus
from app.extraction.schemas import DEFAULT_CURRENCY
from app.models import BankConnection, BankTransaction, Expense, User
from app.schemas.bank import (
    BankConnectionCreate,
    BankConnectionRead,
    BankStatus,
    BankTransactionAdd,
    BankTransactionRead,
    LinkToken,
    SyncSummary,
)
from app.schemas.expense import ExpenseRead

router = APIRouter(prefix="/bank", tags=["bank"])


def bank_unavailable(error: BankError) -> HTTPException:
    """502 Bad Gateway: this server is fine, the service it depends on is not."""
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(error))


def find_connections(db: Session, user: User) -> list[BankConnection]:
    return list(
        db.scalars(
            select(BankConnection)
            .where(BankConnection.user_id == user.id)
            .order_by(BankConnection.id)
        )
    )


def get_transaction_or_404(db: Session, user: User, transaction_id: int) -> BankTransaction:
    transaction = db.get(BankTransaction, transaction_id)
    if transaction is None or transaction.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return transaction


@router.get("/status", response_model=BankStatus)
def get_status(db: DbSession, user: CurrentUser, settings: SettingsDep) -> BankStatus:
    return BankStatus(
        configured=bool(settings.plaid_client_id and settings.plaid_secret),
        connections=[
            BankConnectionRead.model_validate(connection)
            for connection in find_connections(db, user)
        ],
    )


@router.post("/link-token", response_model=LinkToken)
def create_link_token(user: CurrentUser, bank: BankClientDep) -> LinkToken:
    """Step 1 of connecting a bank: get the token that opens Plaid's window."""
    try:
        return LinkToken(link_token=bank.create_link_token(user.id))
    except BankError as error:
        raise bank_unavailable(error) from error


@router.post("/connections", response_model=BankConnectionRead, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: BankConnectionCreate, db: DbSession, user: CurrentUser, bank: BankClientDep
) -> BankConnection:
    """Step 2: swap the browser's one-time token for the access token and keep it."""
    try:
        access_token, item_id = bank.exchange_public_token(payload.public_token)
    except BankError as error:
        raise bank_unavailable(error) from error

    connection = BankConnection(
        user_id=user.id,
        institution_name=payload.institution_name.strip(),
        item_id=item_id,
        access_token=access_token,
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: int, db: DbSession, user: CurrentUser) -> None:
    """Forget a bank. Its imported transactions go too; expenses made from them stay."""
    connection = db.get(BankConnection, connection_id)
    if connection is None or connection.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Bank connection not found")
    db.delete(connection)
    db.commit()


def is_purchase(data: BankTransactionData) -> bool:
    """Only settled money going out becomes something to review.

    Deposits and refunds (zero or negative amounts) are not expenses, and a
    pending transaction may still change or disappear.
    """
    return data.amount > 0 and not data.pending


def import_transaction(
    db: Session, user: User, connection: BankConnection, data: BankTransactionData
) -> bool:
    """Save one transaction for review. Returns False if it was imported before."""
    transaction = BankTransaction(
        user_id=user.id,
        connection_id=connection.id,
        provider_transaction_id=data.transaction_id,
        name=data.name[:200],
        amount=data.amount,
        currency=data.currency or DEFAULT_CURRENCY,
        date=data.date,
        category=suggest_category(data.category, data.detailed_category),
    )
    try:
        # A savepoint: if this INSERT is refused, only it is undone.
        with db.begin_nested():
            db.add(transaction)
    except IntegrityError:
        # The unique rule on provider_transaction_id refused it: already here.
        return False
    return True


@router.post("/sync", response_model=SyncSummary)
def sync_transactions(db: DbSession, user: CurrentUser, bank: BankClientDep) -> SyncSummary:
    """Import what is new at every connected bank.

    Safe to call again: the bookmark Plaid gives (the cursor) means only
    changes since the last import come back, and even if one came back
    twice the database would refuse the duplicate.
    """
    imported = removed = 0
    for connection in find_connections(db, user):
        try:
            result = bank.sync_transactions(connection.access_token, connection.sync_cursor)
        except BankError as error:
            # Keep what earlier connections imported before reporting the failure.
            db.commit()
            raise bank_unavailable(error) from error

        for data in result.added:
            if is_purchase(data) and import_transaction(db, user, connection, data):
                imported += 1

        if result.removed_ids:
            # The bank withdrew these. Ones still waiting for review are
            # dropped; ones already added stay, because the expense exists.
            withdrawn = db.scalars(
                select(BankTransaction).where(
                    BankTransaction.connection_id == connection.id,
                    BankTransaction.provider_transaction_id.in_(result.removed_ids),
                    BankTransaction.status == BankTransactionStatus.NEW,
                )
            ).all()
            for transaction in withdrawn:
                db.delete(transaction)
            removed += len(withdrawn)

        connection.sync_cursor = result.next_cursor
    db.commit()
    return SyncSummary(imported=imported, removed=removed)


@router.get("/transactions", response_model=list[BankTransactionRead])
def list_transactions(
    db: DbSession,
    user: CurrentUser,
    status: BankTransactionStatus = BankTransactionStatus.NEW,
) -> list[BankTransaction]:
    """Imported transactions, newest first. By default the ones waiting for review."""
    return list(
        db.scalars(
            select(BankTransaction)
            .where(BankTransaction.user_id == user.id, BankTransaction.status == status)
            .order_by(BankTransaction.date.desc(), BankTransaction.id.desc())
        )
    )


@router.post("/transactions/{transaction_id}/add", response_model=ExpenseRead)
def add_transaction(
    transaction_id: int, payload: BankTransactionAdd, db: DbSession, user: CurrentUser
) -> Expense:
    """Make an expense from an imported transaction."""
    transaction = get_transaction_or_404(db, user, transaction_id)
    if transaction.status == BankTransactionStatus.ADDED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This transaction was already added to your expenses"
        )

    expense = Expense(
        user_id=user.id,
        merchant=transaction.name,
        date=transaction.date,
        total=transaction.amount,
        currency=transaction.currency,
        category=payload.category or transaction.category,
        notes=f"Imported from {db.get(BankConnection, transaction.connection_id).institution_name}",
    )
    db.add(expense)
    db.flush()
    transaction.status = BankTransactionStatus.ADDED
    transaction.expense_id = expense.id
    db.commit()
    db.refresh(expense)
    return expense


@router.post("/transactions/{transaction_id}/ignore", response_model=BankTransactionRead)
def ignore_transaction(transaction_id: int, db: DbSession, user: CurrentUser) -> BankTransaction:
    """Hide a transaction that is not an expense to track (a transfer, for example)."""
    transaction = get_transaction_or_404(db, user, transaction_id)
    if transaction.status == BankTransactionStatus.NEW:
        transaction.status = BankTransactionStatus.IGNORED
        db.commit()
    return transaction
