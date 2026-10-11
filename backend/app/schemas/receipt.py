import datetime

from pydantic import BaseModel, ConfigDict, computed_field

from app.enums import ReceiptStatus
from app.extraction.checks import find_warnings
from app.extraction.schemas import ExtractedFields


class ReceiptRead(BaseModel):
    """A receipt as returned by the API: raw OCR text plus the extracted fields."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: ReceiptStatus
    raw_text: str | None
    extracted_fields: ExtractedFields | None
    error_message: str | None
    created_at: datetime.datetime

    # Computed fields are not stored; they are worked out each time the
    # receipt is returned, from the extracted fields above.
    @computed_field
    @property
    def warnings(self) -> list[str]:
        """Things the user should double-check before saving."""
        if self.extracted_fields is None:
            return []
        return find_warnings(self.extracted_fields)

    @computed_field
    @property
    def needs_review(self) -> bool:
        return len(self.warnings) > 0
