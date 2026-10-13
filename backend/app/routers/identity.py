from fastapi import APIRouter, HTTPException, status

from app.auth import CurrentUser
from app.database import DbSession
from app.enums import IdentityStatus
from app.identity import get_verification, review
from app.models import IdentityVerification
from app.routers.recurring import Today
from app.schemas.identity import IdentityRead, IdentitySubmit

router = APIRouter(prefix="/identity", tags=["identity"])


def to_read(verification: IdentityVerification | None) -> IdentityRead:
    if verification is None:
        return IdentityRead(status="unverified")
    return IdentityRead(
        status=verification.status.value,
        full_name=verification.full_name,
        document_type=verification.document_type,
        document_last4=verification.document_last4,
        rejection_reason=verification.rejection_reason,
    )


@router.get("", response_model=IdentityRead)
def get_identity(db: DbSession, user: CurrentUser) -> IdentityRead:
    """Where the user's identity check stands."""
    return to_read(get_verification(db, user))


@router.post("", response_model=IdentityRead)
def submit_identity(
    payload: IdentitySubmit, db: DbSession, user: CurrentUser, today: Today
) -> IdentityRead:
    """Submit details for an identity check. The answer is decided at once.

    A rejected user may try again; a verified one cannot change their details.
    """
    verification = get_verification(db, user)
    if verification is not None and verification.status == IdentityStatus.VERIFIED:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Your identity is already verified")

    reason = review(
        date_of_birth=payload.date_of_birth, document_number=payload.document_number, today=today
    )
    if verification is None:
        verification = IdentityVerification(user_id=user.id)
        db.add(verification)
    verification.status = IdentityStatus.VERIFIED if reason is None else IdentityStatus.REJECTED
    verification.full_name = payload.full_name
    verification.date_of_birth = payload.date_of_birth
    verification.country = payload.country
    verification.document_type = payload.document_type
    verification.document_last4 = payload.document_number[-4:]
    verification.rejection_reason = reason
    db.commit()
    db.refresh(verification)
    return to_read(verification)
