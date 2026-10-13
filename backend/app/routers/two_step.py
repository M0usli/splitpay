import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import totp
from app.auth import CurrentUser
from app.database import DbSession
from app.models import TwoStepLogin, User

router = APIRouter(prefix="/auth/two-step", tags=["auth"])

Code = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")]

WRONG_CODE = "That code is not right. Wait for a new one and try again."


class TwoStepRead(BaseModel):
    is_enabled: bool


class TwoStepSetup(BaseModel):
    """What the authenticator app needs. Shown once, while setting up."""

    secret: str
    # The same secret as an otpauth:// address, to draw as a QR code.
    uri: str


class TwoStepCode(BaseModel):
    code: Code


def get_two_step(db: Session, user: User, *, lock: bool = False) -> TwoStepLogin | None:
    query = select(TwoStepLogin).where(TwoStepLogin.user_id == user.id)
    if lock:
        # Locked while a code is checked, so the same code sent twice at the
        # same moment cannot be accepted twice.
        query = query.with_for_update()
    return db.scalar(query)


def accept_code(two_step: TwoStepLogin, code: str) -> bool:
    """True if the code is right and unused. Remembers it so it cannot be used again."""
    now = datetime.datetime.now(datetime.UTC)
    step = totp.matching_step(two_step.secret, code, now, two_step.last_used_step)
    if step is None:
        return False
    two_step.last_used_step = step
    return True


@router.get("", response_model=TwoStepRead)
def read_two_step(db: DbSession, user: CurrentUser) -> TwoStepRead:
    two_step = get_two_step(db, user)
    return TwoStepRead(is_enabled=two_step is not None and two_step.is_enabled)


@router.post("/setup", response_model=TwoStepSetup)
def start_setup(db: DbSession, user: CurrentUser) -> TwoStepSetup:
    """Make a new secret for the authenticator app. Not active until /enable."""
    two_step = get_two_step(db, user)
    if two_step is not None and two_step.is_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Two-step login is already on")
    if two_step is None:
        two_step = TwoStepLogin(user_id=user.id, is_enabled=False)
        db.add(two_step)
    # Starting again gives a fresh secret; an old QR code stops working.
    two_step.secret = totp.new_secret()
    two_step.last_used_step = None
    db.commit()
    return TwoStepSetup(
        secret=two_step.secret, uri=totp.provisioning_uri(two_step.secret, user.email)
    )


@router.post("/enable", response_model=TwoStepRead)
def enable(payload: TwoStepCode, db: DbSession, user: CurrentUser) -> TwoStepRead:
    """Turn two-step login on, by proving the authenticator app shows the right code."""
    two_step = get_two_step(db, user, lock=True)
    if two_step is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Start the set-up first")
    if two_step.is_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Two-step login is already on")
    if not accept_code(two_step, payload.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=WRONG_CODE)
    two_step.is_enabled = True
    db.commit()
    return TwoStepRead(is_enabled=True)


@router.post("/disable", response_model=TwoStepRead)
def disable(payload: TwoStepCode, db: DbSession, user: CurrentUser) -> TwoStepRead:
    """Turn two-step login off. Needs a current code, so a borrowed phone cannot do it."""
    two_step = get_two_step(db, user, lock=True)
    if two_step is None or not two_step.is_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Two-step login is not on")
    if not accept_code(two_step, payload.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=WRONG_CODE)
    db.delete(two_step)
    db.commit()
    return TwoStepRead(is_enabled=False)
