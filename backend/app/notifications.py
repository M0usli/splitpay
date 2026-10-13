"""Short messages that tell a user something happened to their money.

A notification is written in the same database transaction as the event it
describes. So there is never a payment without its message, or a message
about a payment that was rolled back.
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Notification


def money(amount: Decimal) -> str:
    """An amount as it is written in a message: $1,234.50."""
    return f"${amount:,.2f}"


def notify(db: Session, user_id: int, message: str) -> None:
    """Leave a message for a user. Nothing is committed here; the caller commits."""
    db.add(Notification(user_id=user_id, message=message))
