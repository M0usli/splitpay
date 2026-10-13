import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PaymentPin(Base):
    """A user's payment PIN, and how many wrong tries it has had."""

    __tablename__ = "payment_pins"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    # The PIN is never stored, only its Argon2 hash (see app/pin.py).
    pin_hash: Mapped[str] = mapped_column(String(200))
    # Wrong tries in a row. Back to zero after a right one, or when it locks.
    failed_attempts: Mapped[int] = mapped_column(default=0)
    # While this is in the future, no PIN is accepted, right or wrong.
    locked_until: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
