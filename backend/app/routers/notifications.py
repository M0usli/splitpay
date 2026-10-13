import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update

from app.auth import CurrentUser
from app.database import DbSession
from app.models import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])

# The list shows the most recent messages; older ones are not listed.
LIST_LIMIT = 50


class NotificationRead(BaseModel):
    # Lets Pydantic read the fields straight from the database row.
    model_config = ConfigDict(from_attributes=True)

    id: int
    message: str
    is_read: bool
    created_at: datetime.datetime


class NotificationList(BaseModel):
    # How many are unread in total, also beyond the ones listed.
    unread_count: int
    items: list[NotificationRead]


@router.get("", response_model=NotificationList)
def list_notifications(db: DbSession, user: CurrentUser) -> NotificationList:
    """The user's messages, newest first, and how many are unread."""
    unread_count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id)
        .where(Notification.is_read.is_(False))
    )
    items = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(LIST_LIMIT)
    ).all()
    return NotificationList(unread_count=unread_count or 0, items=list(items))


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(db: DbSession, user: CurrentUser) -> None:
    """Mark every message of the user as read."""
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id)
        .where(Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
