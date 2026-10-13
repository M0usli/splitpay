import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import MoneyRequestStatus, TransferKind
from app.models.base import Base, enum_column_type


class Wallet(Base):
    """A place that holds (pretend) money.

    Each user has one. There is also one wallet with no user, the "outside
    world": a top-up moves money from it into a user's wallet. That way money
    never appears from nowhere; it always comes from some wallet.

    A wallet has no balance column. The balance is worked out from the
    transfers, so the two can never disagree.
    """

    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Empty only for the outside-world wallet. unique=True: one wallet per user.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WalletTransfer(Base):
    """One movement of money: out of one wallet and into another.

    This table is the ledger. Rows are only ever added, never changed or
    deleted, so it is a full history of where every cent went.
    """

    __tablename__ = "wallet_transfers"
    __table_args__ = (
        # The database itself refuses a transfer of nothing or less, and a
        # transfer from a wallet to itself.
        CheckConstraint("amount > 0", name="ck_wallet_transfers_amount_positive"),
        CheckConstraint("from_wallet_id <> to_wallet_id", name="ck_wallet_transfers_two_wallets"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[TransferKind] = mapped_column(enum_column_type(TransferKind))
    from_wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id"), index=True)
    to_wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(String(200))
    # A random id the app makes up for each "send" or "top up" the user
    # starts. If the same request arrives twice (a double tap, a retry after
    # a slow network), the second one finds this key already used and the
    # money moves only once.
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class MoneyRequest(Base):
    """One user asking another for money. No money moves until it is paid."""

    __tablename__ = "money_requests"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_money_requests_amount_positive"),
        CheckConstraint("from_user_id <> to_user_id", name="ck_money_requests_two_people"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # The person asking, who will receive the money.
    from_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # The person asked, who will pay.
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[MoneyRequestStatus] = mapped_column(
        enum_column_type(MoneyRequestStatus), default=MoneyRequestStatus.PENDING, index=True
    )
    # The ledger row that paid it. unique=True: a transfer pays one request.
    wallet_transfer_id: Mapped[int | None] = mapped_column(
        ForeignKey("wallet_transfers.id"), unique=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # When it was paid, declined or cancelled.
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
