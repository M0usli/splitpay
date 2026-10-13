"""The payment PIN: setting it, and needing it for every payment.

`client` (Sam) and `other_client` (Alex) already have the PIN `TEST_PIN` and
send it with every request, because most tests are about something else.
`newcomer` has no PIN and sends none.
"""

import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.main import app
from app.models import PaymentPin, User
from app.pin import LOCK_MINUTES, MAX_WRONG_TRIES, PIN_HEADER
from tests.conftest import TEST_PIN, log_in_as
from tests.test_household import ALEX, SAM, create_household
from tests.test_wallet import balance, key, top_up

NEWCOMER = "newcomer@example.com"
WRONG = {PIN_HEADER: "9990"}


@pytest.fixture
def newcomer(client: TestClient, db_session: Session) -> TestClient:
    """A verified user with $100 who has not set a PIN."""
    fresh = TestClient(app)
    log_in_as(fresh, db_session, NEWCOMER, pin=False)
    top_up(fresh, "100.00")
    return fresh


def send(client: TestClient, to_email: str = SAM, amount: str = "5.00", **kwargs):
    payload = {"to_email": to_email, "amount": amount, "idempotency_key": key()}
    return client.post("/wallet/send", json=payload, **kwargs)


def pin_row(db_session: Session, email: str) -> PaymentPin:
    db_session.expire_all()
    user = db_session.scalars(select(User).where(User.email == email)).one()
    return db_session.scalars(select(PaymentPin).where(PaymentPin.user_id == user.id)).one()


# --- setting the PIN ---


def test_a_new_user_has_no_pin(newcomer: TestClient):
    assert newcomer.get("/wallet/pin").json() == {"is_set": False, "locked_minutes": 0}


def test_a_pin_is_stored_as_a_hash(newcomer: TestClient, db_session: Session):
    response = newcomer.put("/wallet/pin", json={"pin": "4826"})

    assert response.status_code == 200
    assert response.json() == {"is_set": True, "locked_minutes": 0}
    stored = pin_row(db_session, NEWCOMER).pin_hash
    assert "4826" not in stored
    assert stored.startswith("$argon2")


@pytest.mark.parametrize("pin", ["123", "12345", "12a4", "", "1234", "0000", "7777"])
def test_a_pin_must_be_four_digits_and_not_too_easy(newcomer: TestClient, pin: str):
    assert newcomer.put("/wallet/pin", json={"pin": pin}).status_code == 422
    assert newcomer.get("/wallet/pin").json()["is_set"] is False


def test_changing_the_pin_needs_the_current_one(newcomer: TestClient):
    newcomer.put("/wallet/pin", json={"pin": "4826"})

    assert newcomer.put("/wallet/pin", json={"pin": "5937"}).status_code == 403
    wrong = newcomer.put("/wallet/pin", json={"pin": "5937", "current_pin": "9990"})
    right = newcomer.put("/wallet/pin", json={"pin": "5937", "current_pin": "4826"})

    assert (wrong.status_code, right.status_code) == (403, 200)
    # The new PIN pays; the old one no longer does.
    assert send(newcomer, headers={PIN_HEADER: "4826"}).status_code == 403
    assert send(newcomer, headers={PIN_HEADER: "5937"}).status_code == 200


@pytest.mark.parametrize("method", ["GET", "PUT"])
def test_the_pin_endpoints_require_a_login(anonymous_client: TestClient, method: str):
    assert anonymous_client.request(method, "/wallet/pin").status_code == 401


# --- paying ---


def test_without_a_pin_set_nothing_can_be_paid(newcomer: TestClient, client: TestClient):
    response = send(newcomer)

    assert response.status_code == 403
    assert response.json()["detail"] == "Set a payment PIN before sending money."
    assert balance(newcomer) == "100.00"


def test_a_payment_without_the_pin_is_refused(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")

    response = send(client, ALEX, headers={PIN_HEADER: ""})

    assert response.status_code == 403
    assert balance(client) == "50.00"


def test_the_right_pin_pays(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")

    assert send(client, ALEX, headers={PIN_HEADER: TEST_PIN}).status_code == 200
    assert (balance(client), balance(other_client)) == ("45.00", "5.00")


def test_a_wrong_pin_moves_nothing_and_counts_down(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")

    first = send(client, ALEX, headers=WRONG)
    second = send(client, ALEX, headers=WRONG)

    assert first.status_code == 403
    assert first.json()["detail"] == "Wrong PIN. 4 tries left."
    assert second.json()["detail"] == "Wrong PIN. 3 tries left."
    assert (balance(client), balance(other_client)) == ("50.00", "0.00")


def test_a_right_pin_resets_the_count(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")
    send(client, ALEX, headers=WRONG)
    send(client, ALEX, headers=WRONG)

    assert send(client, ALEX).status_code == 200

    assert send(client, ALEX, headers=WRONG).json()["detail"] == "Wrong PIN. 4 tries left."


def test_too_many_wrong_pins_lock_even_the_right_one(
    client: TestClient, other_client: TestClient, db_session: Session
):
    top_up(client, "50.00")
    answers = [send(client, ALEX, headers=WRONG).json()["detail"] for _ in range(MAX_WRONG_TRIES)]

    assert answers[-2] == "Wrong PIN. 1 try left."
    assert answers[-1] == f"Too many wrong PINs. Try again in {LOCK_MINUTES} minutes."
    # Locked: the right PIN is refused too, and nothing has moved.
    locked = send(client, ALEX)
    assert locked.status_code == 403
    assert "Too many wrong PINs" in locked.json()["detail"]
    assert client.get("/wallet/pin").json()["locked_minutes"] == LOCK_MINUTES
    assert balance(client) == "50.00"


def test_the_lock_ends_by_itself(client: TestClient, other_client: TestClient, db_session: Session):
    top_up(client, "50.00")
    for _ in range(MAX_WRONG_TRIES):
        send(client, ALEX, headers=WRONG)

    # Pretend the 15 minutes have passed.
    row = pin_row(db_session, SAM)
    row.locked_until = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=1)
    db_session.commit()

    assert client.get("/wallet/pin").json()["locked_minutes"] == 0
    assert send(client, ALEX).status_code == 200


def test_every_way_of_paying_asks_for_the_pin(client: TestClient, other_client: TestClient):
    top_up(client, "100.00")
    request = other_client.post("/wallet/requests", json={"to_email": SAM, "amount": "5.00"}).json()
    household = create_household(client)
    joined = other_client.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    ).json()
    alex_id = next(member["id"] for member in joined["members"] if member["email"] == ALEX)
    saved = client.post(
        "/bills/saved", json={"biller_code": "maplenet", "account_number": "AB-1234"}
    ).json()
    no_pin = {PIN_HEADER: ""}

    answers = [
        send(client, ALEX, headers=no_pin),
        client.post(
            f"/wallet/requests/{request['id']}/pay", json={"idempotency_key": key()}, headers=no_pin
        ),
        client.post(
            "/household/pay",
            json={"to_user_id": alex_id, "amount": "5.00", "idempotency_key": key()},
            headers=no_pin,
        ),
        client.post(
            "/bills/pay",
            json={"saved_biller_id": saved["id"], "amount": "5.00", "idempotency_key": key()},
            headers=no_pin,
        ),
    ]

    assert [answer.status_code for answer in answers] == [403, 403, 403, 403]
    assert balance(client) == "100.00"


def test_things_that_move_no_money_need_no_pin(newcomer: TestClient, client: TestClient):
    # Adding money, asking for money and declining a request all work without a PIN.
    assert top_up(newcomer, "10.00").status_code == 200
    assert (
        newcomer.post("/wallet/requests", json={"to_email": SAM, "amount": "5.00"}).status_code
        == 201
    )
    request = client.post("/wallet/requests", json={"to_email": NEWCOMER, "amount": "5.00"}).json()
    assert newcomer.post(f"/wallet/requests/{request['id']}/decline").status_code == 200
