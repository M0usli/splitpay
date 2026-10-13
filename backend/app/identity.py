"""Identity checks ("know your customer", KYC) before money can be sent.

This is a simulation. A real wallet sends the person's documents to a
specialist company, which compares the photo, checks the document is
genuine and looks the name up on sanctions lists. Here the "review" is two
simple rules, decided at once, so the whole flow can be shown and tested.

What is real is how the result is used: sending money is refused on the
server until the user is verified, whatever the page shows.
"""

import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import DbSession
from app.enums import IdentityStatus
from app.models import IdentityVerification, User

MINIMUM_AGE = 18
# A document number ending like this is always rejected, so the "rejected"
# path can be tried on purpose. Payment sandboxes use magic test values the
# same way (Plaid's "user_good", for example).
ALWAYS_REJECTED_ENDING = "0000"

NOT_VERIFIED_MESSAGE = "Verify your identity before sending money."


def age_on(date_of_birth: datetime.date, today: datetime.date) -> int:
    """Full years lived. The birthday counts from the day itself."""
    had_birthday_this_year = (today.month, today.day) >= (date_of_birth.month, date_of_birth.day)
    return today.year - date_of_birth.year - (0 if had_birthday_this_year else 1)


def review(
    *, date_of_birth: datetime.date, document_number: str, today: datetime.date
) -> str | None:
    """Decide a submission. Returns the reason it is rejected, or None when it passes."""
    if age_on(date_of_birth, today) < MINIMUM_AGE:
        return f"You must be {MINIMUM_AGE} or older to send money."
    if document_number.endswith(ALWAYS_REJECTED_ENDING):
        return "This document number could not be confirmed. Check it and try again."
    return None


def get_verification(db: Session, user: User) -> IdentityVerification | None:
    return db.scalar(select(IdentityVerification).where(IdentityVerification.user_id == user.id))


def is_verified(db: Session, user: User) -> bool:
    verification = get_verification(db, user)
    return verification is not None and verification.status == IdentityStatus.VERIFIED


def get_verified_user(db: DbSession, user: CurrentUser) -> User:
    """Dependency for endpoints that send money: the user must be verified.

    403 Forbidden, not 401: the server knows who this is, but they are not
    allowed to do this yet.
    """
    if not is_verified(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=NOT_VERIFIED_MESSAGE)
    return user


# Use this instead of CurrentUser on any endpoint that takes money out of a wallet.
VerifiedUser = Annotated[User, Depends(get_verified_user)]
