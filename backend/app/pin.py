"""The payment PIN: four digits asked for every time money leaves a wallet.

Being logged in is not enough to pay. If someone picks up an unlocked phone,
the login cookie is already there; the PIN is something only the owner
knows. Banks call asking again at the moment of paying "step-up
authentication".

A 4-digit PIN has only 10,000 possibilities, so it is protected in two ways:
- it is stored as an Argon2 hash, like the password, never as digits;
- after a few wrong tries it locks for a while, so it cannot be guessed by
  trying them all.

The PIN travels in the `X-Payment-Pin` header, so the request bodies of the
paying endpoints did not have to change.
"""

import datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, hash_password, verify_password
from app.database import DbSession
from app.models import PaymentPin, User

MAX_WRONG_TRIES = 5
LOCK_MINUTES = 15

PIN_HEADER = "X-Payment-Pin"


def refuse(message: str) -> HTTPException:
    # 403 Forbidden: the server knows who this is, but will not let them pay.
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=message)


def get_pin(db: Session, user: User, *, lock: bool = False) -> PaymentPin | None:
    query = select(PaymentPin).where(PaymentPin.user_id == user.id)
    if lock:
        # Locked while it is checked, so guesses sent at the same moment are
        # counted one after another and cannot skip the limit on wrong tries.
        query = query.with_for_update()
    return db.scalar(query)


def minutes_locked(pin: PaymentPin, now: datetime.datetime) -> int:
    """Whole minutes left on the lock, rounded up. Zero when it is not locked."""
    if pin.locked_until is None or pin.locked_until <= now:
        return 0
    seconds = (pin.locked_until - now).total_seconds()
    return max(1, -(-int(seconds) // 60))


def check_pin(db: Session, user: User, entered: str | None) -> None:
    """Raise unless `entered` is the user's PIN. Counts wrong tries and locks.

    A wrong try is committed straight away. The request then fails, and
    without the commit its count would be rolled back with everything else.
    """
    pin = get_pin(db, user, lock=True)
    if pin is None:
        raise refuse("Set a payment PIN before sending money.")

    now = datetime.datetime.now(datetime.UTC)
    wait = minutes_locked(pin, now)
    if wait > 0:
        db.rollback()  # releases the row lock
        raise refuse(f"Too many wrong PINs. Try again in {wait} minutes.")
    if not entered:
        db.rollback()
        raise refuse("Enter your payment PIN.")

    if verify_password(entered, pin.pin_hash):
        pin.failed_attempts = 0
        pin.locked_until = None
        db.flush()
        return

    pin.failed_attempts += 1
    tries_left = MAX_WRONG_TRIES - pin.failed_attempts
    if tries_left <= 0:
        pin.failed_attempts = 0
        pin.locked_until = now + datetime.timedelta(minutes=LOCK_MINUTES)
    db.commit()
    if tries_left <= 0:
        raise refuse(f"Too many wrong PINs. Try again in {LOCK_MINUTES} minutes.")
    raise refuse(f"Wrong PIN. {tries_left} {'try' if tries_left == 1 else 'tries'} left.")


def set_pin(db: Session, user: User, new_pin: str) -> PaymentPin:
    pin = get_pin(db, user)
    if pin is None:
        pin = PaymentPin(user_id=user.id, failed_attempts=0)
        db.add(pin)
    pin.pin_hash = hash_password(new_pin)
    return pin


def get_paying_user(
    db: DbSession,
    user: CurrentUser,
    entered: Annotated[str | None, Header(alias=PIN_HEADER)] = None,
) -> User:
    """Dependency for endpoints that take money out of a wallet."""
    check_pin(db, user, entered)
    return user


# Use this instead of CurrentUser on any endpoint that pays.
PayingUser = Annotated[User, Depends(get_paying_user)]
