"""Shared test fixtures.

Tests run against a separate PostgreSQL database (the normal database name
plus "_test"), so they never touch real data. OCR and the LLM are replaced by
fakes, so no test runs real OCR through the API or makes a paid API call.
Uploads go to a temporary folder.
"""

from collections.abc import Generator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db
from app.extraction import get_llm_client
from app.main import app
from app.models import Base
from app.ocr import get_ocr_engine

MAIN_DATABASE_URL = make_url(get_settings().database_url)
TEST_DATABASE_NAME = f"{MAIN_DATABASE_URL.database}_test"
TEST_DATABASE_URL = MAIN_DATABASE_URL.set(database=TEST_DATABASE_NAME)


class FakeOcrEngine:
    """Stands in for Tesseract. Tests choose what it returns or raises."""

    def __init__(self) -> None:
        self.text = "FAKE STORE\nTOTAL 12.34"
        self.error: Exception | None = None
        self.received_images: list[np.ndarray] = []

    def image_to_text(self, image: np.ndarray) -> str:
        self.received_images.append(image)
        if self.error is not None:
            raise self.error
        return self.text


GOOD_REPLY = (
    '{"merchant": "Loblaws", "date": "2026-10-05", "subtotal": "8.48", "tax": "1.10", '
    '"total": "9.58", "currency": null, "category": "Groceries"}'
)


class FakeLlmClient:
    """Stands in for Claude. Returns the queued replies one after another."""

    def __init__(self) -> None:
        self.replies: list[str] = [GOOD_REPLY]
        self.error: Exception | None = None
        self.user_messages: list[str] = []

    def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        self.user_messages.append(user)
        if self.error is not None:
            raise self.error
        # Keep returning the last reply if a test asks more times than it queued.
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]


def create_test_database_if_missing() -> None:
    # CREATE DATABASE cannot run inside a transaction, hence AUTOCOMMIT.
    admin_engine = create_engine(MAIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": TEST_DATABASE_NAME},
        ).scalar()
        if not exists:
            connection.execute(text(f'CREATE DATABASE "{TEST_DATABASE_NAME}"'))
    admin_engine.dispose()


@pytest.fixture(scope="session")
def test_engine() -> Generator[Engine, None, None]:
    """Create the test database once for the whole test run."""
    create_test_database_if_missing()
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine: Engine) -> Generator[Session, None, None]:
    """Give each test empty tables and a session to work with."""
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    with Session(test_engine, autoflush=False, expire_on_commit=False) as session:
        yield session
    Base.metadata.drop_all(test_engine)


@pytest.fixture
def fake_ocr() -> FakeOcrEngine:
    return FakeOcrEngine()


@pytest.fixture
def fake_llm() -> FakeLlmClient:
    return FakeLlmClient()


@pytest.fixture
def test_settings(tmp_path: Path) -> Settings:
    """Settings for tests: uploads go to a temporary folder, and there is no API key."""
    return Settings(upload_dir=tmp_path / "uploads", anthropic_api_key="")


@pytest.fixture
def client(
    db_session: Session,
    fake_ocr: FakeOcrEngine,
    fake_llm: FakeLlmClient,
    test_settings: Settings,
) -> Generator[TestClient, None, None]:
    """An API client wired to the test database, fake OCR, fake LLM and temp uploads."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_ocr_engine] = lambda: fake_ocr
    app.dependency_overrides[get_llm_client] = lambda: fake_llm
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield TestClient(app)
    app.dependency_overrides.clear()
