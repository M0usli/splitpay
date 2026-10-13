"""The identity check, and the rule that only verified users can send money.

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
from tests.test_household import ALEX, SAM, create_household
from tests.test_wallet import balance, key, top_up

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


# --- what an unverified user can and cannot do ---


def test_an_unverified_user_can_add_and_receive_money(newcomer: TestClient, client: TestClient):
    top_up(client, "50.00")

    assert top_up(newcomer, "20.00").status_code == 200
    sent = client.post(
        "/wallet/send", json={"to_email": NEWCOMER, "amount": "5.00", "idempotency_key": key()}
    )

    assert sent.status_code == 200
    assert balance(newcomer) == "25.00"


def test_an_unverified_user_cannot_send_money(newcomer: TestClient, client: TestClient):
    top_up(newcomer, "20.00")

    response = newcomer.post(
        "/wallet/send", json={"to_email": SAM, "amount": "5.00", "idempotency_key": key()}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Verify your identity before sending money."
    assert (balance(newcomer), balance(client)) == ("20.00", "0.00")


def test_an_unverified_user_cannot_pay_a_request(newcomer: TestClient, client: TestClient):
    top_up(newcomer, "20.00")
    request = client.post("/wallet/requests", json={"to_email": NEWCOMER, "amount": "5.00"}).json()

    response = newcomer.post(
        f"/wallet/requests/{request['id']}/pay", json={"idempotency_key": key()}
    )

    assert response.status_code == 403
    assert balance(newcomer) == "20.00"
    # Declining moves no money, so it is allowed.
    assert newcomer.post(f"/wallet/requests/{request['id']}/decline").status_code == 200


def test_an_unverified_user_cannot_pay_a_bill(newcomer: TestClient):
    top_up(newcomer, "20.00")
    saved = newcomer.post(
        "/bills/saved", json={"biller_code": "maplenet", "account_number": "AB-1234"}
    ).json()

    response = newcomer.post(
        "/bills/pay",
        json={"saved_biller_id": saved["id"], "amount": "5.00", "idempotency_key": key()},
    )

    assert response.status_code == 403
    assert balance(newcomer) == "20.00"


def test_an_unverified_user_cannot_pay_a_split_bill_debt(newcomer: TestClient, client: TestClient):
    top_up(newcomer, "20.00")
    household = create_household(client)
    members = newcomer.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    ).json()
    sam_id = next(member["id"] for member in members["members"] if member["email"] == SAM)

    response = newcomer.post(
        "/household/pay", json={"to_user_id": sam_id, "amount": "5.00", "idempotency_key": key()}
    )

    assert response.status_code == 403
    assert balance(newcomer) == "20.00"


def test_after_verifying_the_same_user_can_send(newcomer: TestClient, client: TestClient):
    top_up(newcomer, "20.00")
    submit(newcomer)

    response = newcomer.post(
        "/wallet/send", json={"to_email": ALEX, "amount": "5.00", "idempotency_key": key()}
    )

    # Alex has no account in this test, so the answer is "no such email":
    # the request got past the identity check.
    assert response.status_code == 404


def test_a_rejected_user_still_cannot_send(newcomer: TestClient, client: TestClient):
    top_up(newcomer, "20.00")
    submit(newcomer, document_number="P1230000")

    response = newcomer.post(
        "/wallet/send", json={"to_email": SAM, "amount": "5.00", "idempotency_key": key()}
    )

    assert response.status_code == 403
