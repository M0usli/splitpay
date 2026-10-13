import datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import DocumentType, IdentityStatus
from app.models.base import Base, enum_column_type


class IdentityVerification(Base):
    """The result of a user's identity check. A user has at most one row.

    The full document number is never stored. Once the check is done only
    its last 4 characters are kept, enough to show the user which document
    was used. Keeping no more than is needed is called data minimisation.
    """

    __tablename__ = "identity_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    # unique=True: one result per user. A new attempt replaces the old one.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    status: Mapped[IdentityStatus] = mapped_column(enum_column_type(IdentityStatus))
    full_name: Mapped[str] = mapped_column(String(100))
    date_of_birth: Mapped[datetime.date] = mapped_column(Date)
    # Two-letter country code, for example "CA".
    country: Mapped[str] = mapped_column(String(2))
    document_type: Mapped[DocumentType] = mapped_column(enum_column_type(DocumentType))
    document_last4: Mapped[str] = mapped_column(String(4))
    # Why it was rejected, in words that can be shown to the user.
    rejection_reason: Mapped[str | None] = mapped_column(String(200))
    submitted_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
