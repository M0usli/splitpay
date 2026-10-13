from fastapi import APIRouter, HTTPException, Response, status
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
from app.routers.two_step import WRONG_CODE, accept_code, get_two_step
from app.schemas.user import Credentials, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, response: Response, db: DbSession, settings: SettingsDep) -> User:
    """Create an account and log it in."""
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


@router.post("/login", response_model=UserRead)
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
