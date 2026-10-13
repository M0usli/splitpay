from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TwoStepLogin(Base):
    """A user's authenticator-app secret for two-step login."""

    __tablename__ = "two_step_logins"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    # Shared with the user's authenticator app. Unlike a password it cannot be
    # stored as a hash, because the server needs it to work out the codes. A
    # production system would encrypt this column.
    secret: Mapped[str] = mapped_column(String(64))
    # False between scanning the QR code and proving it worked with a first code.
    is_enabled: Mapped[bool] = mapped_column(default=False)
    # The time step of the last code that was accepted. A code is good once.
    last_used_step: Mapped[int | None] = mapped_column(BigInteger)
