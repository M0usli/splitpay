"""Paying out of a user's wallet, and how much a user may send in a day.

Every payment a user makes (a send, a paid request, a split-bill payment,
a bill) goes through `spend`. So the rules about who may send how much
live in one place, and a new kind of payment gets them by calling it.

The daily limit depends on the identity check. Real wallets work the same
way, with "tiers": the more the wallet knows about you, the more it lets
you move.
"""

import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.enums import TransferKind
from app.identity import is_verified
from app.models import User, Wallet, WalletTransfer
from app.wallet import (
    ZERO,
    InsufficientFunds,
    LimitExceeded,
    get_or_create_wallet,
    move_money,
    sent_since,
)

# How much may leave a wallet per day, before and after the identity check.
UNVERIFIED_DAILY_LIMIT = Decimal("50.00")
VERIFIED_DAILY_LIMIT = Decimal("2000.00")


def daily_limit_for(db: Session, user: User) -> Decimal:
    return VERIFIED_DAILY_LIMIT if is_verified(db, user) else UNVERIFIED_DAILY_LIMIT


def start_of_today() -> datetime.datetime:
    """Midnight at the start of today, in UTC. The daily limit counts from here."""
    now = datetime.datetime.now(datetime.UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def remaining_today(db: Session, user: User, wallet: Wallet) -> Decimal:
    """How much more the user may send today. Never below zero."""
    left = daily_limit_for(db, user) - sent_since(db, wallet, start_of_today())
    return max(left, ZERO)


def limit_message(db: Session, user: User, remaining: Decimal) -> str:
    if is_verified(db, user):
        return (
            f"This is more than you can send today. You have ${remaining:,.2f} left "
            f"of your ${VERIFIED_DAILY_LIMIT:,.2f} daily limit."
        )
    return (
        f"Unverified accounts can send ${UNVERIFIED_DAILY_LIMIT:,.2f} a day, and you have "
        f"${remaining:,.2f} left. Verify your identity to send up to "
        f"${VERIFIED_DAILY_LIMIT:,.2f} a day."
    )


def spend(
    db: Session,
    user: User,
    *,
    kind: TransferKind,
    destination: Wallet,
    amount: Decimal,
    idempotency_key: str,
    note: str | None = None,
) -> WalletTransfer:
    """Move money out of the user's wallet, or refuse with an HTTP error.

    Nothing is committed here; the endpoint commits, so the payment can be
    part of a bigger change that succeeds or fails as a whole.
    """
    try:
        return move_money(
            db,
            kind=kind,
            source=get_or_create_wallet(db, user),
            destination=destination,
            amount=amount,
            idempotency_key=idempotency_key,
            note=note,
            daily_limit=daily_limit_for(db, user),
            day_start=start_of_today(),
        )
    except InsufficientFunds as error:
        # 409 Conflict: the request is well formed, but the wallet's state does not allow it.
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(error)) from error
    except LimitExceeded as error:
        # 403 Forbidden: this user is not allowed to send this much today.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail=limit_message(db, user, error.remaining)
        ) from error
