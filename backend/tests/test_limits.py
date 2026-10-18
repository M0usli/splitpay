"""The daily sending limit: small before the identity check, larger after.

`client` (Sam) and `other_client` (Alex) are verified. `newcomer` is not.
"""

import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.enums import TransferKind
from app.main import app
from app.models import User
from app.spending import UNVERIFIED_DAILY_LIMIT, VERIFIED_DAILY_LIMIT, start_of_today
from app.wallet import LimitExceeded, get_or_create_wallet, move_money, sent_since
from tests.conftest import log_in_as
from tests.test_household import SAM, create_household
from tests.test_identity import GOOD
from tests.test_wallet import balance, key, send, top_up

NEWCOMER = "newcomer@example.com"


@pytest.fixture
def newcomer(client: TestClient, db_session: Session) -> TestClient:
    """A logged-in user who has not verified their identity, with $200 in the wallet."""
    fresh = TestClient(app)
    log_in_as(fresh, db_session, NEWCOMER, verified=False)
    for _ in range(2):
        top_up(fresh, "100.00")
    return fresh


def limits(client: TestClient) -> dict:
    return client.get("/wallet/limits").json()


# --- reading the limit ---


def test_the_limit_depends_on_the_identity_check(client: TestClient, newcomer: TestClient):
    assert limits(newcomer) == {
        "level": "unverified",
        "daily_limit": "50.00",
        "sent_today": "0.00",
        "remaining": "50.00",
    }
    assert limits(client)["level"] == "verified"
    assert limits(client)["daily_limit"] == "2000.00"


def test_sending_uses_up_the_limit_and_adding_money_does_not(newcomer: TestClient):
    send(newcomer, SAM, "20.00")

    assert limits(newcomer)["sent_today"] == "20.00"
    assert limits(newcomer)["remaining"] == "30.00"


def test_the_limits_endpoint_requires_a_login(anonymous_client: TestClient):
    assert anonymous_client.get("/wallet/limits").status_code == 401


# --- an unverified user ---


def test_an_unverified_user_can_send_up_to_the_limit(newcomer: TestClient, client: TestClient):
    assert send(newcomer, SAM, "30.00").status_code == 200
    # Exactly reaching the limit is allowed.
    assert send(newcomer, SAM, "20.00").status_code == 200

    assert (balance(newcomer), balance(client)) == ("150.00", "50.00")


def test_going_over_the_limit_is_refused_and_says_how_to_raise_it(
    newcomer: TestClient, client: TestClient
):
    send(newcomer, SAM, "30.00")

    response = send(newcomer, SAM, "20.01")

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Unverified accounts can send $50.00 a day, and you have $20.00 left. "
        "Verify your identity to send up to $2,000.00 a day."
    )
    assert (balance(newcomer), balance(client)) == ("170.00", "30.00")


def test_every_way_of_paying_counts_toward_the_same_limit(newcomer: TestClient, client: TestClient):
    """A send, a paid request, a split-bill payment and a bill: $15 each makes $60."""
    assert send(newcomer, SAM, "15.00").status_code == 200

    request = client.post("/wallet/requests", json={"to_email": NEWCOMER, "amount": "15.00"}).json()
    paid = newcomer.post(f"/wallet/requests/{request['id']}/pay", json={"idempotency_key": key()})
    assert paid.status_code == 200

    household = create_household(client)
    joined = newcomer.post("/household/join", json={"invite_code": household["invite_code"]}).json()
    sam_id = next(member["id"] for member in joined["members"] if member["email"] == SAM)
    settled = newcomer.post(
        "/household/pay", json={"to_user_id": sam_id, "amount": "15.00", "idempotency_key": key()}
    )
    assert settled.status_code == 201

    saved = newcomer.post(
        "/bills/saved", json={"biller_code": "maplenet", "account_number": "AB-1234"}
    ).json()
    bill = newcomer.post(
        "/bills/pay",
        json={"saved_biller_id": saved["id"], "amount": "15.00", "idempotency_key": key()},
    )

    # $45 is gone, so the fourth $15 does not fit under $50.
    assert bill.status_code == 403
    assert limits(newcomer)["remaining"] == "5.00"
    assert balance(newcomer) == "155.00"


def test_a_refused_request_stays_open(newcomer: TestClient, client: TestClient):
    request = client.post("/wallet/requests", json={"to_email": NEWCOMER, "amount": "60.00"}).json()

    response = newcomer.post(
        f"/wallet/requests/{request['id']}/pay", json={"idempotency_key": key()}
    )

    assert response.status_code == 403
    assert client.get("/wallet/requests").json()[0]["status"] == "pending"


def test_a_repeated_request_is_not_counted_twice(newcomer: TestClient):
    same_key = key()
    payload = {"to_email": SAM, "amount": "50.00", "idempotency_key": same_key}

    first = newcomer.post("/wallet/send", json=payload)
    second = newcomer.post("/wallet/send", json=payload)

    # The repeat is the same payment, so it is not refused for the limit.
    assert (first.status_code, second.status_code) == (200, 200)
    assert limits(newcomer)["sent_today"] == "50.00"


def test_verifying_raises_the_limit_at_once(newcomer: TestClient):
    send(newcomer, SAM, "50.00")
    assert send(newcomer, SAM, "1.00").status_code == 403

    newcomer.post("/identity", json=GOOD)

    assert send(newcomer, SAM, "100.00").status_code == 200
    assert limits(newcomer) == {
        "level": "verified",
        "daily_limit": "2000.00",
        "sent_today": "150.00",
        "remaining": "1850.00",
    }


def test_a_rejected_user_keeps_the_small_limit(newcomer: TestClient):
    newcomer.post("/identity", json={**GOOD, "document_number": "P1230000"})

    assert send(newcomer, SAM, "50.01").status_code == 403


# --- a verified user ---


def test_a_verified_user_has_a_limit_too(client: TestClient, other_client: TestClient):
    for _ in range(3):
        top_up(client, "1000.00")
    assert send(client, "alex@example.com", "1500.00").status_code == 200

    response = send(client, "alex@example.com", "500.01")

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "This is more than you can send today. You have $500.00 left of your $2,000.00 daily limit."
    )


def test_not_enough_money_is_still_its_own_answer(client: TestClient, other_client: TestClient):
    top_up(client, "10.00")

    response = send(client, "alex@example.com", "10.01")

    assert response.status_code == 409
    assert response.json()["detail"] == "You do not have enough money in your wallet."


# --- the ledger function underneath ---


def test_only_money_sent_since_the_start_counts(client: TestClient, db_session: Session):
    top_up(client, "100.00")
    send_to = db_session.query(User).filter_by(email=SAM).one()
    wallet = get_or_create_wallet(db_session, send_to)
    outside = get_or_create_wallet(db_session, None)
    move_money(
        db_session,
        kind=TransferKind.BILL,
        source=wallet,
        destination=outside,
        amount=Decimal("40.00"),
        idempotency_key=key(),
    )
    db_session.commit()

    assert sent_since(db_session, wallet, start_of_today()) == Decimal("40.00")
    # From tomorrow's point of view, nothing has been sent yet: the limit starts again.
    tomorrow = start_of_today() + datetime.timedelta(days=1)
    assert sent_since(db_session, wallet, tomorrow) == Decimal("0")


def test_move_money_refuses_over_the_limit_and_says_what_is_left(
    client: TestClient, db_session: Session
):
    top_up(client, "100.00")
    wallet = get_or_create_wallet(db_session, db_session.query(User).filter_by(email=SAM).one())
    outside = get_or_create_wallet(db_session, None)

    with pytest.raises(LimitExceeded) as refusal:
        move_money(
            db_session,
            kind=TransferKind.BILL,
            source=wallet,
            destination=outside,
            amount=Decimal("30.01"),
            idempotency_key=key(),
            daily_limit=Decimal("30.00"),
            day_start=start_of_today(),
        )

    assert refusal.value.remaining == Decimal("30.00")


def test_the_two_limits_are_what_the_page_says():
    assert UNVERIFIED_DAILY_LIMIT == Decimal("50.00")
    assert VERIFIED_DAILY_LIMIT == Decimal("2000.00")
