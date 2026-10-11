"""Database connection setup."""

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

# The engine manages a pool of connections to PostgreSQL. It does not connect
# until the first query, so importing this module never fails.
engine = create_engine(get_settings().database_url, pool_pre_ping=True)

# A factory for sessions. A session is one unit of work with the database:
# it tracks the objects you load or add, and writes them when you commit.
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Open a session for one request and close it when the request ends."""
    with SessionLocal() as session:
        yield session


# Endpoints declare a parameter of this type and FastAPI calls get_db for them.
DbSession = Annotated[Session, Depends(get_db)]


def check_database() -> bool:
    """Return True if the database answers a trivial query."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False
