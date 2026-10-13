"""Paying a split-bill debt to a housemate straight from the wallet.

`client` is logged in as Sam and `other_client` as Alex. Sam pays for
things; Alex owes Sam and pays back from the wallet.
"""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Settlement, WalletTransfer
from tests.test_household import (
    ALEX,
    SAM,
    add_shared,
    payments,
    share_household,
    third_client,  # noqa: F401  (a fixture defined in test_household.py)
)
from tests.test_wallet import balance, history, key, top_up, total_of_all_wallets


def pay(client: TestClient, to_user_id: int, amount: str, idempotency_key: str | None = None):
    payload = {
        "to_user_id": to_user_id,
        "amount": amount,
        "idempotency_key": idempotency_key or key(),
    }
    return client.post("/household/pay", json=payload)


def count(db_session: Session, model) -> int:
    return db_session.scalar(select(func.count()).select_from(model))


def alex_owes_sam_fifty(client: TestClient, other_client: TestClient) -> dict[str, int]:
    members = share_household(client, other_client)
    add_shared(client, "100.00")  # split equally: Alex owes Sam 50.00
    return members


def test_paying_moves_the_money_and_settles_the_debt(client: TestClient, other_client: TestClient):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "80.00")
    assert payments(other_client) == [(ALEX, SAM, "50.00")]

    response = pay(other_client, members[SAM], "50.00")

    assert response.status_code == 201
    body = response.json()
    assert (body["paid_by"]["email"], body["paid_to"]["email"]) == (ALEX, SAM)
    assert body["amount"] == "50.00"
    assert body["paid_from_wallet"] is True
    # The money moved between the wallets...
    assert (balance(other_client), balance(client)) == ("30.00", "50.00")
    # ...and nobody owes anything any more.
    assert payments(other_client) == []


def test_both_wallets_show_the_payment_as_a_split_bill_line(
    client: TestClient, other_client: TestClient
):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "50.00")

    pay(other_client, members[SAM], "50.00")

    paid, received = history(other_client)[0], history(client)[0]
    assert (paid["kind"], paid["direction"], paid["counterparty"]) == ("settlement", "out", SAM)
    assert (received["kind"], received["direction"], received["counterparty"]) == (
        "settlement",
        "in",
        ALEX,
    )
    assert paid["note"] == "Split bill"


def test_without_enough_money_nothing_happens_at_all(
    client: TestClient, other_client: TestClient, db_session: Session
):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "49.99")

    response = pay(other_client, members[SAM], "50.00")

    assert response.status_code == 409
    assert response.json()["detail"] == "You do not have enough money in your wallet."
    # Neither half happened: the money stayed and the debt is still there.
    assert (balance(other_client), balance(client)) == ("49.99", "0.00")
    assert payments(other_client) == [(ALEX, SAM, "50.00")]
    assert count(db_session, Settlement) == 0


def test_a_double_tap_pays_once(client: TestClient, other_client: TestClient, db_session: Session):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "200.00")
    same_key = key()

    first = pay(other_client, members[SAM], "50.00", same_key)
    second = pay(other_client, members[SAM], "50.00", same_key)

    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert balance(other_client) == "150.00"
    assert count(db_session, Settlement) == 1
    # One top-up and one payment in the ledger, not two payments.
    assert count(db_session, WalletTransfer) == 2


def test_a_request_id_from_a_normal_send_cannot_be_reused_to_settle(
    client: TestClient, other_client: TestClient, db_session: Session
):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "200.00")
    same_key = key()
    other_client.post(
        "/wallet/send", json={"to_email": SAM, "amount": "50.00", "idempotency_key": same_key}
    )

    response = pay(other_client, members[SAM], "50.00", same_key)

    assert response.status_code == 409
    assert count(db_session, Settlement) == 0
    assert payments(other_client) == [(ALEX, SAM, "50.00")]


def test_part_of_a_debt_can_be_paid(client: TestClient, other_client: TestClient):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "20.00")

    assert pay(other_client, members[SAM], "20.00").status_code == 201

    assert payments(other_client) == [(ALEX, SAM, "30.00")]


def test_a_wallet_payment_cannot_be_undone(client: TestClient, other_client: TestClient):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "50.00")
    settlement = pay(other_client, members[SAM], "50.00").json()

    response = other_client.delete(f"/household/settlements/{settlement['id']}")

    assert response.status_code == 409
    assert "cannot be undone" in response.json()["detail"]
    assert payments(other_client) == []
    assert balance(client) == "50.00"


def test_a_payment_recorded_by_hand_is_not_marked_as_from_the_wallet(
    client: TestClient, other_client: TestClient
):
    members = alex_owes_sam_fifty(client, other_client)

    recorded = other_client.post(
        "/household/settlements", json={"to_user_id": members[SAM], "amount": "50.00"}
    ).json()

    assert recorded["paid_from_wallet"] is False
    # No money moved, and it can still be undone.
    assert balance(client) == "0.00"
    assert other_client.delete(f"/household/settlements/{recorded['id']}").status_code == 204


def test_a_payment_must_go_to_another_member(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "100.00")
    outsider_id = third_client.get("/auth/me").json()["id"]

    assert pay(other_client, members[ALEX], "10.00").status_code == 422  # to yourself
    assert pay(other_client, outsider_id, "10.00").status_code == 422
    assert balance(other_client) == "100.00"


def test_paying_needs_a_household_and_a_login(client: TestClient, anonymous_client: TestClient):
    assert pay(client, 2, "5.00").status_code == 404
    anonymous_client.cookies.clear()
    assert pay(anonymous_client, 2, "5.00").status_code == 401


def test_money_is_still_never_created_or_lost(
    client: TestClient, other_client: TestClient, db_session: Session
):
    members = alex_owes_sam_fifty(client, other_client)
    top_up(other_client, "60.00")
    pay(other_client, members[SAM], "50.00")
    pay(other_client, members[SAM], "50.00")  # refused: only 10.00 left

    assert total_of_all_wallets(db_session) == Decimal("0")
