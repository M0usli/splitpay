import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Credentials(BaseModel):
    """Request body for logging in."""

    # EmailStr rejects text that is not shaped like an email address.
    email: EmailStr
    # The upper limit stops someone sending a huge password to keep the server
    # busy hashing it.
    password: str = Field(max_length=128)
    # The 6-digit code from an authenticator app. Needed only by accounts
    # that turned two-step login on.
    code: str | None = Field(default=None, pattern=r"^\d{6}$")

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, email: str) -> str:
        """Treat "Sam@Example.com" and "sam@example.com" as the same account."""
        return email.lower()


class UserCreate(Credentials):
    """Request body for registering. A new password must be at least 8 characters."""

    password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    """A user as returned by the API. The password hash is never included."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    created_at: datetime.datetime
