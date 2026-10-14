import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import (
    CurrentUser,
    SessionToken,
    end_session,
    hash_password,
    start_session,
    verify_password,
)
from app.config import SettingsDep
from app.database import DbSession
from app.models import User
from app.rate_limit import limit_by_address
from app.routers.two_step import WRONG_CODE, accept_code, get_two_step
from app.schemas.user import Credentials, SignupInfo, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


# At most 10 log-in or sign-up tries per 10 minutes from one address. Enough
# for a person who mistypes; far too few to guess passwords or 2-step codes.
login_limit = Depends(limit_by_address("login", limit=10, window_seconds=600))
signup_limit = Depends(limit_by_address("signup", limit=10, window_seconds=600))


@router.get("/signup", response_model=SignupInfo)
def signup_info(settings: SettingsDep) -> SignupInfo:
    """Whether sign-up is open, by invitation, or closed."""
    return SignupInfo(mode=effective_signup_mode(settings))


def effective_signup_mode(settings) -> str:
    # "invite" with no code set would let nobody in by accident; say "closed" instead.
    if settings.signup_mode == "invite" and not settings.signup_invite_code:
        return "closed"
    return settings.signup_mode


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[signup_limit],
)
def register(payload: UserCreate, response: Response, db: DbSession, settings: SettingsDep) -> User:
    """Create an account and log it in, if sign-up allows it."""
    mode = effective_signup_mode(settings)
    if mode == "closed":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Sign-up is closed.")
    if mode == "invite":
        # compare_digest takes the same time for a near miss as for a far one.
        given = (payload.invite_code or "").strip()
        if not secrets.compare_digest(given.encode(), settings.signup_invite_code.encode()):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="That invite code is not right.")
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique rule on users.email refused the row: the email is taken.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="An account with this email already exists"
        ) from None

    start_session(db, user, response, settings)
    return user


@router.post("/login", response_model=UserRead, dependencies=[login_limit])
def login(payload: Credentials, response: Response, db: DbSession, settings: SettingsDep) -> User:
    user = db.scalar(select(User).where(User.email == payload.email))
    # One message for both mistakes, so the reply does not reveal which
    # emails have an account.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Wrong email or password")

    # Second step, only for accounts that turned it on: something the user
    # has (their phone), after something they know (the password).
    # 403, not 401: the password was right, but that is not enough here.
    two_step = get_two_step(db, user, lock=True)
    if two_step is not None and two_step.is_enabled:
        if payload.code is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Enter the 6-digit code from your authenticator app.",
            )
        if not accept_code(two_step, payload.code):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=WRONG_CODE)

    start_session(db, user, response, settings)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, db: DbSession, token: SessionToken = None) -> None:
    end_session(db, token, response)


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser) -> User:
    """The logged-in user. The frontend calls this to learn who is signed in."""
    return user
