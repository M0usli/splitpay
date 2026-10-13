import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints, field_validator

from app.auth import CurrentUser
from app.database import DbSession
from app.pin import check_pin, get_pin, minutes_locked, set_pin

router = APIRouter(prefix="/wallet/pin", tags=["wallet"])

Pin = Annotated[str, StringConstraints(pattern=r"^\d{4}$")]

# The PINs people pick most often, and so the first ones a thief tries.
TOO_EASY = {"1234", "4321", "1212", "0123"}


class PinSet(BaseModel):
    """Request body for creating or changing the payment PIN."""

    pin: Pin
    # Needed only when a PIN already exists.
    current_pin: Pin | None = None

    @field_validator("pin")
    @classmethod
    def not_too_easy(cls, pin: str) -> str:
        if pin in TOO_EASY or len(set(pin)) == 1:
            raise ValueError("This PIN is too easy to guess. Choose another.")
        return pin


class PinRead(BaseModel):
    is_set: bool
    # Minutes until a PIN is accepted again after too many wrong tries; 0 when not locked.
    locked_minutes: int


@router.get("", response_model=PinRead)
def read_pin(db: DbSession, user: CurrentUser) -> PinRead:
    """Whether the user has a payment PIN. The PIN itself can never be read back."""
    pin = get_pin(db, user)
    if pin is None:
        return PinRead(is_set=False, locked_minutes=0)
    now = datetime.datetime.now(datetime.UTC)
    return PinRead(is_set=True, locked_minutes=minutes_locked(pin, now))


@router.put("", response_model=PinRead)
def write_pin(payload: PinSet, db: DbSession, user: CurrentUser) -> PinRead:
    """Create the PIN, or change it by giving the current one."""
    if get_pin(db, user) is not None:
        if payload.current_pin is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail="Enter your current PIN to change it."
            )
        # Counts wrong tries and locks, exactly as when paying.
        check_pin(db, user, payload.current_pin)
    set_pin(db, user, payload.pin)
    db.commit()
    return PinRead(is_set=True, locked_minutes=0)
