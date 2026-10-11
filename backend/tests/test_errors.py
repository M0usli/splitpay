"""Tests for the error handlers in app/errors.py."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.ocr import OcrError
from tests.conftest import FakeOcrEngine
from tests.samples import encode, make_text_image


@pytest.fixture
def client_without_database() -> Generator[TestClient, None, None]:
    """An API client whose database connection always fails."""

    def broken_get_db() -> Generator[Session, None, None]:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))
        yield  # never reached; it makes this function a generator, like get_db

    app.dependency_overrides[get_db] = broken_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_database_down_gives_a_clear_503(client_without_database: TestClient) -> None:
    response = client_without_database.get("/expenses")

    assert response.status_code == 503
    assert response.json() == {
        "detail": "The database is not available right now. Try again in a moment."
    }


def test_database_down_response_can_be_read_by_the_frontend(
    client_without_database: TestClient,
) -> None:
    # The browser only lets the frontend read a response that carries this
    # CORS header. Without it the user would see "could not reach the backend".
    response = client_without_database.get("/expenses", headers={"Origin": "http://localhost:3000"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_upload_failures_are_logged(
    client: TestClient, fake_ocr: FakeOcrEngine, caplog: pytest.LogCaptureFixture
) -> None:
    fake_ocr.error = OcrError("No text could be found in this file.")

    response = client.post(
        "/receipts", files={"file": ("r.png", encode(make_text_image(), ".png"), "image/png")}
    )

    assert response.json()["status"] == "failed"
    assert "OCR failed for receipt" in caplog.text
