"""The identity check. What it unlocks (the daily limit) is tested in test_limits.py.

`client` (Sam) and `other_client` (Alex) are already verified, because most
tests are about something else. The `newcomer` fixture is a user who has
not been checked yet.
"""

import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.identity import age_on, review
from app.main import app
from app.models import IdentityVerification
from app.routers.recurring import get_today
from tests.conftest import log_in_as

TODAY = datetime.date(2026, 10, 13)
NEWCOMER = "newcomer@example.com"

GOOD = {
    "full_name": "  Noor Example ",
    "date_of_birth": "2000-05-17",
    "country": "CA",
    "document_type": "passport",
    "document_number": " p1234567 ",
}


@pytest.fixture
def newcomer(client: TestClient, db_session: Session) -> TestClient:
    """A logged-in user who has not verified their identity."""
    app.dependency_overrides[get_today] = lambda: TODAY
    fresh = TestClient(app)
    log_in_as(fresh, db_session, NEWCOMER, verified=False)
    return fresh


def submit(client: TestClient, **changes):
    return client.post("/identity", json={**GOOD, **changes})


# --- the rules of the review ---


def test_age_counts_full_years():
    born = datetime.date(2008, 10, 13)

    assert age_on(born, datetime.date(2026, 10, 12)) == 17
    # The 18th birthday itself counts.
    assert age_on(born, datetime.date(2026, 10, 13)) == 18


def test_the_review_passes_an_adult_with_an_ordinary_document():
    assert (
        review(date_of_birth=datetime.date(2000, 1, 1), document_number="P1234567", today=TODAY)
        is None
    )


def test_the_review_rejects_a_minor_and_the_test_document():
    minor = review(date_of_birth=datetime.date(2010, 1, 1), document_number="P1234567", today=TODAY)
    test_value = review(
        date_of_birth=datetime.date(2000, 1, 1), document_number="P1230000", today=TODAY
    )

    assert minor == "You must be 18 or older to send money."
    assert "could not be confirmed" in test_value


# --- submitting ---


def test_a_new_user_is_unverified(newcomer: TestClient):
    assert newcomer.get("/identity").json() == {
        "status": "unverified",
        "full_name": None,
        "document_type": None,
        "document_last4": None,
        "rejection_reason": None,
    }


def test_good_details_are_verified_at_once(newcomer: TestClient):
    response = submit(newcomer)

    assert response.status_code == 200
    assert response.json() == {
        "status": "verified",
        "full_name": "Noor Example",
        "document_type": "passport",
        "document_last4": "4567",
        "rejection_reason": None,
    }
    assert newcomer.get("/identity").json()["status"] == "verified"


def test_only_the_last_four_characters_of_the_document_are_kept(
    newcomer: TestClient, db_session: Session
):
    submit(newcomer, document_number="AB-99887766")

    row = db_session.scalars(
        select(IdentityVerification).order_by(IdentityVerification.id.desc())
    ).first()
    assert row.document_last4 == "7766"
    # No column holds the whole number.
    assert all("99887766" not in str(value) for value in vars(row).values())


def test_someone_under_18_is_rejected(newcomer: TestClient):
    response = submit(newcomer, date_of_birth="2010-01-01")

    assert response.json()["status"] == "rejected"
    assert response.json()["rejection_reason"] == "You must be 18 or older to send money."


def test_a_rejected_user_can_try_again(newcomer: TestClient):
    assert submit(newcomer, document_number="P1230000").json()["status"] == "rejected"

    again = submit(newcomer)

    assert again.json()["status"] == "verified"
    assert again.json()["rejection_reason"] is None


def test_a_verified_user_cannot_submit_again(newcomer: TestClient):
    submit(newcomer)

    response = submit(newcomer, full_name="Someone Else")

    assert response.status_code == 409
    assert newcomer.get("/identity").json()["full_name"] == "Noor Example"


@pytest.mark.parametrize(
    "changes",
    [
        {"full_name": "A"},
        {"date_of_birth": "1850-01-01"},
        {"date_of_birth": "2999-01-01"},
        {"date_of_birth": "not a date"},
        {"country": "ZZ"},
        {"document_type": "library_card"},
        {"document_number": "123"},
        {"document_number": "has space 123"},
    ],
)
def test_bad_details_are_refused(newcomer: TestClient, changes: dict):
    assert submit(newcomer, **changes).status_code == 422
    assert newcomer.get("/identity").json()["status"] == "unverified"


def test_one_users_check_says_nothing_about_another(newcomer: TestClient, db_session: Session):
    submit(newcomer)
    stranger = TestClient(app)
    log_in_as(stranger, db_session, "stranger@example.com", verified=False)

    assert stranger.get("/identity").json()["status"] == "unverified"


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_the_identity_endpoints_require_a_login(anonymous_client: TestClient, method: str):
    assert anonymous_client.request(method, "/identity").status_code == 401
