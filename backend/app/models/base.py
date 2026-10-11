from enum import StrEnum

from sqlalchemy import Enum
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Parent class of every model. SQLAlchemy collects their tables here."""


def enum_column_type(enum_class: type[StrEnum]) -> Enum:
    """Column type that stores an enum as its text value, e.g. "Bills & Utilities".

    Without values_callable SQLAlchemy would store the member name
    ("BILLS_UTILITIES"). native_enum=False keeps it a plain VARCHAR column.
    """
    return Enum(
        enum_class,
        native_enum=False,
        length=32,
        values_callable=lambda members: [member.value for member in members],
    )
