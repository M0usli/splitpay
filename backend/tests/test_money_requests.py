"""Requesting money from another user, and paying, declining or cancelling a request.

`client` is logged in as Sam and `other_client` as Alex. Sam asks Alex for
money in most tests.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import WalletTransfer
from tests.test_household import ALEX, SAM, third_client  # noqa: F401  (a fixture)
from tests.test_wallet import balance, history, key, top_up, total_of_all_wallets


def ask(client: TestClient, to_email: str, amount: str, **extra):
    return client.post("/wallet/requests", json={"to_email": to_email, "amount": amount, **extra})


def requests(client: TestClient) -> list[dict]:
    return client.get("/wallet/requests").json()


def pay(client: TestClient, request_id: int, idempotency_key: str | None = None):
    return client.post(
        f"/wallet/requests/{request_id}/pay", json={"idempotency_key": idempotency_key or key()}
    )


# --- asking ---


def test_a_request_is_seen_from_both_sides(client: TestClient, other_client: TestClient):
    response = ask(client, ALEX, "20.00", note="  Pizza  ")

    assert response.status_code == 201
    mine = response.json()
    assert (mine["direction"], mine["counterparty"]) == ("outgoing", ALEX)
    assert (mine["amount"], mine["note"], mine["status"]) == ("20.00", "Pizza", "pending")
    theirs = requests(other_client)[0]
    assert (theirs["direction"], theirs["counterparty"], theirs["id"]) == (
        "incoming",
        SAM,
        mine["id"],
    )


def test_asking_moves_no_money(client: TestClient, other_client: TestClient):
    top_up(other_client, "100.00")

    ask(client, ALEX, "20.00")

    assert (balance(client), balance(other_client)) == ("0.00", "100.00")


@pytest.mark.parametrize("amount", ["0", "-5.00", "1.999", "10000.01"])
def test_a_bad_amount_is_rejected(client: TestClient, other_client: TestClient, amount: str):
    assert ask(client, ALEX, amount).status_code == 422


def test_you_cannot_ask_yourself_or_an_unknown_email(client: TestClient):
    assert ask(client, SAM, "5.00").status_code == 422
    assert ask(client, "nobody@example.com", "5.00").status_code == 404
    assert requests(client) == []


# --- paying ---


def test_paying_a_request_moves_the_money_and_closes_it(
    client: TestClient, other_client: TestClient
):
    top_up(other_client, "50.00")
    request = ask(client, ALEX, "20.00", note="Pizza").json()

    response = pay(other_client, request["id"])

    assert response.status_code == 200
    assert response.json()["status"] == "paid"
    assert (balance(other_client), balance(client)) == ("30.00", "20.00")
    assert requests(client)[0]["status"] == "paid"
    # Both wallets show it as a paid request, with the note.
    paid, received = history(other_client)[0], history(client)[0]
    assert (paid["kind"], paid["direction"], paid["counterparty"], paid["note"]) == (
        "request",
        "out",
        SAM,
        "Pizza",
    )
    assert (received["kind"], received["direction"], received["counterparty"]) == (
        "request",
        "in",
        ALEX,
    )


def test_without_enough_money_the_request_stays_open(client: TestClient, other_client: TestClient):
    top_up(other_client, "19.99")
    request = ask(client, ALEX, "20.00").json()

    response = pay(other_client, request["id"])

    assert response.status_code == 409
    assert response.json()["detail"] == "You do not have enough money in your wallet."
    assert requests(client)[0]["status"] == "pending"
    assert (balance(other_client), balance(client)) == ("19.99", "0.00")


def test_a_double_tap_pays_once(client: TestClient, other_client: TestClient, db_session: Session):
    top_up(other_client, "100.00")
    request = ask(client, ALEX, "20.00").json()
    same_key = key()

    first = pay(other_client, request["id"], same_key)
    second = pay(other_client, request["id"], same_key)

    assert (first.status_code, second.status_code) == (200, 200)
    assert second.json()["status"] == "paid"
    assert balance(other_client) == "80.00"
    # One top-up and one payment in the ledger.
    assert db_session.scalar(select(func.count()).select_from(WalletTransfer)) == 2


def test_a_second_tap_with_a_new_id_still_pays_once(client: TestClient, other_client: TestClient):
    top_up(other_client, "100.00")
    request = ask(client, ALEX, "20.00").json()

    pay(other_client, request["id"])
    again = pay(other_client, request["id"])  # for example from a second device

    assert again.json()["status"] == "paid"
    assert balance(other_client) == "80.00"


def test_only_the_person_asked_can_pay(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
):
    top_up(client, "100.00")
    top_up(third_client, "100.00")
    request = ask(client, ALEX, "20.00").json()

    # Not the person who asked, and not a stranger: both get "not found".
    assert pay(client, request["id"]).status_code == 404
    assert pay(third_client, request["id"]).status_code == 404
    assert requests(client)[0]["status"] == "pending"


# --- declining and cancelling ---


def test_the_person_asked_can_decline(client: TestClient, other_client: TestClient):
    top_up(other_client, "100.00")
    request = ask(client, ALEX, "20.00").json()

    response = other_client.post(f"/wallet/requests/{request['id']}/decline")

    assert response.json()["status"] == "declined"
    assert requests(client)[0]["status"] == "declined"
    assert balance(other_client) == "100.00"
    # A declined request can no longer be paid.
    assert pay(other_client, request["id"]).status_code == 409


def test_the_person_who_asked_can_cancel(client: TestClient, other_client: TestClient):
    request = ask(client, ALEX, "20.00").json()

    response = client.post(f"/wallet/requests/{request['id']}/cancel")

    assert response.json()["status"] == "cancelled"
    assert requests(other_client)[0]["status"] == "cancelled"
    top_up(other_client, "100.00")
    assert pay(other_client, request["id"]).status_code == 409


def test_each_side_can_only_do_its_own_action(client: TestClient, other_client: TestClient):
    request = ask(client, ALEX, "20.00").json()

    # Sam asked, so Sam cannot decline; Alex was asked, so Alex cannot cancel.
    assert client.post(f"/wallet/requests/{request['id']}/decline").status_code == 404
    assert other_client.post(f"/wallet/requests/{request['id']}/cancel").status_code == 404
    assert requests(client)[0]["status"] == "pending"


def test_a_finished_request_cannot_be_changed_again(client: TestClient, other_client: TestClient):
    top_up(other_client, "100.00")
    request = ask(client, ALEX, "20.00").json()
    pay(other_client, request["id"])

    assert other_client.post(f"/wallet/requests/{request['id']}/decline").status_code == 409
    assert client.post(f"/wallet/requests/{request['id']}/cancel").status_code == 409
    assert requests(client)[0]["status"] == "paid"


# --- the list, and the usual guards ---


def test_requests_are_listed_newest_first_and_only_to_the_two_people(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
):
    ask(client, ALEX, "10.00", note="first")
    ask(other_client, SAM, "5.00", note="second")

    assert [(item["note"], item["direction"]) for item in requests(client)] == [
        ("second", "incoming"),
        ("first", "outgoing"),
    ]
    assert requests(third_client) == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/wallet/requests"),
        ("GET", "/wallet/requests"),
        ("POST", "/wallet/requests/1/pay"),
        ("POST", "/wallet/requests/1/decline"),
        ("POST", "/wallet/requests/1/cancel"),
    ],
)
def test_every_request_endpoint_requires_a_login(
    anonymous_client: TestClient, method: str, path: str
):
    assert anonymous_client.request(method, path).status_code == 401


def test_money_is_still_never_created_or_lost(
    client: TestClient, other_client: TestClient, db_session: Session
):
    top_up(other_client, "30.00")
    first = ask(client, ALEX, "20.00").json()
    second = ask(client, ALEX, "20.00").json()
    pay(other_client, first["id"])
    pay(other_client, second["id"])  # refused: only 10.00 left

    assert total_of_all_wallets(db_session) == Decimal("0")
    assert (balance(client), balance(other_client)) == ("20.00", "10.00")
