"""Passwords, login sessions, and finding out who is making a request.

How a login works:
1. The user sends their email and password once.
2. The server makes a long random token, saves its hash in the `sessions`
   table, and sends the token back in a cookie.
3. The browser sends that cookie with every later request, and
   get_current_user looks the token up to find the user.
"""

import datetime
import hashlib
import secrets
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import DbSession
from app.models import User, UserSession

SESSION_COOKIE = "session"

# Argon2 is a hash made for passwords: it is slow on purpose and adds a random
# "salt" to each one, so stolen hashes are very expensive to guess from.
password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def hash_token(token: str) -> str:
    """SHA-256 of a session token. Fast is fine here: the token is already
    long and random, unlike a password, so it cannot be guessed."""
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(db: Session, user: User, response: Response, settings: Settings) -> None:
    """Log the user in: save a new session and put its token in a cookie."""
    token = secrets.token_urlsafe(32)
    lifetime = datetime.timedelta(days=settings.session_days)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.datetime.now(datetime.UTC) + lifetime,
        )
    )
    db.commit()

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(lifetime.total_seconds()),
        # JavaScript cannot read an HttpOnly cookie, so a script injected into
        # the page cannot steal the login.
        httponly=True,
        # Lax: other websites cannot make the browser send this cookie with
        # requests that change data (protection against CSRF).
        samesite="lax",
        secure=settings.cookie_secure,
    )


def end_session(db: Session, token: str | None, response: Response) -> None:
    """Log out: forget the session on the server and in the browser."""
    if token is not None:
        session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if session is not None:
            db.delete(session)
            db.commit()
    response.delete_cookie(SESSION_COOKIE)


# Endpoints declare a parameter of this type to read the session cookie.
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def get_current_user(db: DbSession, token: SessionToken = None) -> User:
    """Return the logged-in user, or answer 401 if there is no valid session."""
    not_logged_in = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not logged in")
    if token is None:
        raise not_logged_in

    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or session.expires_at <= datetime.datetime.now(datetime.UTC):
        raise not_logged_in

    user = db.get(User, session.user_id)
    if user is None:
        raise not_logged_in
    return user


# Endpoints declare a parameter of this type to require a logged-in user.
CurrentUser = Annotated[User, Depends(get_current_user)]
