import datetime
from typing import Any

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import ReceiptStatus
from app.models.base import Base, enum_column_type


class Receipt(Base):
    """An uploaded receipt file and the result of processing it."""

    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_path: Mapped[str] = mapped_column(String(500))
    raw_text: Mapped[str | None] = mapped_column(Text)
    # What the AI model extracted, stored as JSON. Keeping the original answer
    # lets us tell later whether the user had to correct it.
    extracted_fields: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[ReceiptStatus] = mapped_column(
        enum_column_type(ReceiptStatus), default=ReceiptStatus.PENDING
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
