import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, field_validator

from app.enums import DocumentType

# The countries offered on the form. A real wallet lists the countries it is
# licensed to work in.
CountryCode = Literal["CA", "US", "GB", "SA", "AE"]

FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]

# Letters, digits and dashes, as printed on a document.
DocumentNumber = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_upper=True,
        min_length=6,
        max_length=20,
        pattern=r"^[A-Za-z0-9-]+$",
    ),
]

EARLIEST_BIRTH_YEAR = 1900


class IdentitySubmit(BaseModel):
    """Request body for an identity check."""

    full_name: FullName
    date_of_birth: datetime.date
    country: CountryCode
    document_type: DocumentType
    # Used for the check and then dropped; only the last 4 characters are stored.
    document_number: DocumentNumber

    @field_validator("date_of_birth")
    @classmethod
    def a_possible_birthday(cls, date_of_birth: datetime.date) -> datetime.date:
        if date_of_birth.year < EARLIEST_BIRTH_YEAR or date_of_birth > datetime.date.today():
            raise ValueError("Enter your real date of birth")
        return date_of_birth


class IdentityRead(BaseModel):
    """Where the logged-in user's identity check stands."""

    # "unverified" means nothing was submitted yet.
    status: Literal["unverified", "verified", "rejected"]
    full_name: str | None = None
    document_type: DocumentType | None = None
    document_last4: str | None = None
    rejection_reason: str | None = None
