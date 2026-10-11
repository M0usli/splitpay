import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    """A person with an account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Stored in lowercase. unique=True makes the database itself refuse a
    # second account with the same email, even if two requests arrive at once.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    # The password is never stored, only its Argon2 hash (see app/auth.py).
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UserSession(Base):
    """One login. The browser holds a random token; this row says whose it is.

    Named UserSession because SQLAlchemy already has a class called Session.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # ondelete="CASCADE": deleting a user also deletes their sessions.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # SHA-256 of the token, as 64 hex characters. Storing only the hash means
    # a leaked database cannot be used to log in as someone.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
