"""Moving (pretend) money between wallets.

The rules that keep the money right:

1. Money only moves. Every transfer takes an amount out of one wallet and
   puts the same amount into another, so the total over all wallets is
   always zero and never changes.
2. A balance is never stored. It is added up from the transfers.
3. A user's wallet can never go below zero. The sender's wallet row is
   locked while the balance is checked and the transfer is written, so two
   sends at the same moment cannot both spend the same money.
4. A request that arrives twice moves money once (the idempotency key).
"""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.enums import TransferKind
from app.models import User, Wallet, WalletTransfer

ZERO = Decimal("0.00")


class WalletError(Exception):
    """A transfer was refused. The message is safe to show to the user."""


class InsufficientFunds(WalletError):
    """The sender does not have enough money."""


def get_or_create_wallet(db: Session, user: User | None) -> Wallet:
    """The user's wallet, or the outside-world wallet when `user` is None.

    It is made the first time it is needed.
    """
    owner = Wallet.user_id.is_(None) if user is None else Wallet.user_id == user.id
    wallet = db.scalar(select(Wallet).where(owner))
    if wallet is not None:
        return wallet

    wallet = Wallet(user_id=None if user is None else user.id)
    try:
        # A savepoint: if another request made the same wallet a moment ago,
        # only this INSERT is undone and the existing wallet is used.
        with db.begin_nested():
            db.add(wallet)
    except IntegrityError:
        return db.scalars(select(Wallet).where(owner)).one()
    return wallet


def get_balance(db: Session, wallet: Wallet) -> Decimal:
    """Everything that came in minus everything that went out."""
    money_in = db.scalar(
        select(func.coalesce(func.sum(WalletTransfer.amount), 0)).where(
            WalletTransfer.to_wallet_id == wallet.id
        )
    )
    money_out = db.scalar(
        select(func.coalesce(func.sum(WalletTransfer.amount), 0)).where(
            WalletTransfer.from_wallet_id == wallet.id
        )
    )
    return Decimal(money_in) - Decimal(money_out)


def find_transfer(db: Session, idempotency_key: str) -> WalletTransfer | None:
    return db.scalar(
        select(WalletTransfer).where(WalletTransfer.idempotency_key == idempotency_key)
    )


def move_money(
    db: Session,
    *,
    kind: TransferKind,
    source: Wallet,
    destination: Wallet,
    amount: Decimal,
    idempotency_key: str,
    note: str | None = None,
    allow_overdraft: bool = False,
) -> WalletTransfer:
    """Move `amount` from `source` to `destination` and return the ledger row.

    Nothing is committed here; the caller commits, so a transfer can be part
    of a bigger change that succeeds or fails as a whole.

    `allow_overdraft` is only for the outside-world wallet, which is allowed
    to go below zero: its negative balance is the total ever topped up.
    """
    # Lock the wallet the money leaves. A second request spending from the
    # same wallet waits here until this one commits, then sees the new balance.
    db.execute(select(Wallet.id).where(Wallet.id == source.id).with_for_update())

    # Checked after taking the lock, so a repeat of this very request that
    # was running at the same time has finished and its row is visible.
    existing = find_transfer(db, idempotency_key)
    if existing is not None:
        return existing

    if not allow_overdraft and get_balance(db, source) < amount:
        raise InsufficientFunds("You do not have enough money in your wallet.")

    transfer = WalletTransfer(
        kind=kind,
        from_wallet_id=source.id,
        to_wallet_id=destination.id,
        amount=amount,
        note=note,
        idempotency_key=idempotency_key,
    )
    try:
        with db.begin_nested():
            db.add(transfer)
    except IntegrityError:
        # The same key was used on a different wallet at the same moment.
        # The unique rule refused this row; return the one that won.
        winner = find_transfer(db, idempotency_key)
        if winner is None:
            raise
        return winner
    return transfer
