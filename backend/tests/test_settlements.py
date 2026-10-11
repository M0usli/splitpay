"""Settling up: recording that one household member paid another back.

`client` is logged in as Sam and `other_client` as Alex.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.models import Settlement
from app.splitting import net_balances
from tests.test_household import (
    ALEX,
    SAM,
    add_shared,
    make_expense,
    nets,
    payments,
    share_household,
    third_client,  # noqa: F401  (a fixture defined in test_household.py)
)


def settle(client: TestClient, to_user_id: int, amount: str, **extra):
    payload = {"to_user_id": to_user_id, "amount": amount, **extra}
    return client.post("/household/settlements", json=payload)


def test_paying_back_clears_the_balance(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    add_shared(client, "100.00")  # Alex owes Sam 50.00

    response = settle(other_client, members[SAM], "50.00")

    assert response.status_code == 201
    assert response.json()["paid_by"]["email"] == ALEX
    assert response.json()["paid_to"]["email"] == SAM
    assert payments(client) == []
    assert nets(client) == {SAM: "0.00", ALEX: "0.00"}


def test_paying_back_part_leaves_the_rest(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    add_shared(client, "100.00")

    settle(other_client, members[SAM], "20.00")

    assert payments(client) == [(ALEX, SAM, "30.00")]


def test_paying_too_much_turns_the_debt_around(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    add_shared(client, "100.00")

    settle(other_client, members[SAM], "60.00")

    assert payments(client) == [(SAM, ALEX, "10.00")]


def test_net_balances_with_a_settlement_still_add_up_to_zero():
    expenses = [make_expense(1, {1: "30.00", 2: "30.00", 3: "30.00"})]
    paid_back = [Settlement(from_user_id=2, to_user_id=1, amount=Decimal("30.00"))]

    result = net_balances([1, 2, 3], expenses, paid_back)

    assert result == {1: Decimal("30.00"), 2: Decimal("0.00"), 3: Decimal("-30.00")}
    assert sum(result.values()) == 0


@pytest.mark.parametrize("amount", ["0", "-5.00", "1.999"])
def test_a_payment_must_be_a_positive_amount_in_cents(
    client: TestClient, other_client: TestClient, amount: str
):
    members = share_household(client, other_client)

    assert settle(other_client, members[SAM], amount).status_code == 422


def test_a_payment_must_go_to_another_member(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
):
    members = share_household(client, other_client)
    outsider_id = third_client.get("/auth/me").json()["id"]

    assert settle(client, members[SAM], "10.00").status_code == 422  # to yourself
    assert settle(client, outsider_id, "10.00").status_code == 422
    assert client.get("/household/settlements").json() == []


def test_settlements_are_listed_newest_first_for_every_member(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)
    settle(other_client, members[SAM], "10.00")
    settle(client, members[ALEX], "4.00")

    listed = client.get("/household/settlements").json()

    assert [(item["paid_by"]["email"], item["amount"]) for item in listed] == [
        (SAM, "4.00"),
        (ALEX, "10.00"),
    ]
    assert other_client.get("/household/settlements").json() == listed


def test_only_the_person_who_paid_can_remove_a_payment(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)
    add_shared(client, "100.00")
    payment = settle(other_client, members[SAM], "50.00").json()
    url = f"/household/settlements/{payment['id']}"

    assert client.delete(url).status_code == 404
    assert other_client.delete(url).status_code == 204
    # The debt is back.
    assert payments(client) == [(ALEX, SAM, "50.00")]


def test_settlements_in_another_currency_are_kept_apart(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)
    add_shared(client, "100.00")

    settle(other_client, members[SAM], "50.00", currency="USD")

    assert payments(client) == [(ALEX, SAM, "50.00")]
    assert payments(client, currency="USD") == [(SAM, ALEX, "50.00")]


def test_settlement_endpoints_need_a_household(client: TestClient):
    assert client.get("/household/settlements").status_code == 404
    assert settle(client, 1, "5.00").status_code == 404
