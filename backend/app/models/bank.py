import datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import BankTransactionStatus, Category
from app.models.base import Base, enum_column_type


class BankConnection(Base):
    """A (sandbox) bank the user connected through Plaid."""

    __tablename__ = "bank_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    institution_name: Mapped[str] = mapped_column(String(200))
    # Plaid's id for this connection.
    item_id: Mapped[str] = mapped_column(String(100), unique=True)
    # The key that lets this server read the account. It never leaves the
    # backend. Here it only opens a pretend sandbox account; for real
    # accounts it would have to be stored encrypted.
    access_token: Mapped[str] = mapped_column(Text)
    # Plaid's bookmark for "everything up to here is imported". Empty until
    # the first sync.
    sync_cursor: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BankTransaction(Base):
    """A transaction imported from a bank, waiting for the user to decide on it."""

    __tablename__ = "bank_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("bank_connections.id", ondelete="CASCADE"), index=True
    )
    # Plaid's id for the transaction. unique=True is what stops the same
    # transaction from being imported twice.
    provider_transaction_id: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    date: Mapped[datetime.date] = mapped_column(Date)
    # The category suggested from the bank's own one. The user can change it.
    category: Mapped[Category] = mapped_column(enum_column_type(Category))
    status: Mapped[BankTransactionStatus] = mapped_column(
        enum_column_type(BankTransactionStatus), default=BankTransactionStatus.NEW, index=True
    )
    # The expense made from this transaction, once the user added it.
    expense_id: Mapped[int | None] = mapped_column(ForeignKey("expenses.id", ondelete="SET NULL"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
