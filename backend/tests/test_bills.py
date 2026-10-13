"""Paying pretend bills from the wallet: billers, saved billers, payments and receipts.

`client` is logged in as Sam and `other_client` as Alex.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import WalletTransfer
from tests.test_wallet import balance, history, key, top_up, total_of_all_wallets


def save(client: TestClient, biller_code: str = "northern-hydro", account_number: str = "AB-1234"):
    return client.post(
        "/bills/saved", json={"biller_code": biller_code, "account_number": account_number}
    )


def pay(client: TestClient, saved_id: int, amount: str, idempotency_key: str | None = None):
    payload = {
        "saved_biller_id": saved_id,
        "amount": amount,
        "idempotency_key": idempotency_key or key(),
    }
    return client.post("/bills/pay", json=payload)


# --- billers and saved billers ---


def test_the_billers_are_listed(client: TestClient):
    billers = client.get("/bills/billers").json()

    assert {"code": "northern-hydro", "name": "Northern Hydro", "kind": "Electricity"} in billers
    assert len(billers) >= 3


def test_a_biller_is_saved_with_a_tidied_account_number(client: TestClient):
    response = save(client, account_number="  ab-1234 ")

    assert response.status_code == 201
    saved = response.json()
    assert saved["biller"]["name"] == "Northern Hydro"
    assert saved["account_number"] == "AB-1234"
    assert client.get("/bills/saved").json() == [saved]


def test_saving_the_same_account_twice_keeps_one(client: TestClient):
    first = save(client).json()
    second = save(client, account_number="ab-1234").json()

    assert second["id"] == first["id"]
    assert len(client.get("/bills/saved").json()) == 1


def test_two_accounts_at_the_same_company_are_both_kept(client: TestClient):
    save(client, account_number="AB-1234")
    save(client, account_number="CD-5678")

    assert len(client.get("/bills/saved").json()) == 2


@pytest.mark.parametrize("account_number", ["", "123", "has space", "x" * 21, "semi;colon"])
def test_a_bad_account_number_is_rejected(client: TestClient, account_number: str):
    assert save(client, account_number=account_number).status_code == 422


def test_an_unknown_biller_is_rejected(client: TestClient):
    assert save(client, biller_code="no-such-company").status_code == 422


def test_saved_billers_are_private(client: TestClient, other_client: TestClient):
    saved = save(client).json()
    top_up(other_client, "100.00")

    assert other_client.get("/bills/saved").json() == []
    assert other_client.delete(f"/bills/saved/{saved['id']}").status_code == 404
    assert pay(other_client, saved["id"], "10.00").status_code == 404
    assert balance(other_client) == "100.00"


# --- paying ---


def test_paying_a_bill_takes_the_money_and_gives_a_receipt(client: TestClient):
    top_up(client, "100.00")
    saved = save(client).json()

    response = pay(client, saved["id"], "64.20")

    assert response.status_code == 201
    receipt = response.json()
    assert receipt["reference"] == f"BP-{receipt['id']:06d}"
    assert receipt["biller"]["name"] == "Northern Hydro"
    assert (receipt["account_number"], receipt["amount"], receipt["currency"]) == (
        "AB-1234",
        "64.20",
        "CAD",
    )
    assert balance(client) == "35.80"
    assert client.get("/bills/payments").json() == [receipt]
    # The wallet history shows it as a bill, with the company's name.
    line = history(client)[0]
    assert (line["kind"], line["direction"], line["amount"], line["note"]) == (
        "bill",
        "out",
        "64.20",
        "Northern Hydro",
    )
    assert line["counterparty"] is None


def test_without_enough_money_nothing_is_paid(client: TestClient):
    top_up(client, "10.00")
    saved = save(client).json()

    response = pay(client, saved["id"], "10.01")

    assert response.status_code == 409
    assert response.json()["detail"] == "You do not have enough money in your wallet."
    assert balance(client) == "10.00"
    assert client.get("/bills/payments").json() == []


@pytest.mark.parametrize("amount", ["0", "-5.00", "1.999", "10000.01"])
def test_a_bad_amount_is_rejected(client: TestClient, amount: str):
    top_up(client, "100.00")
    saved = save(client).json()

    assert pay(client, saved["id"], amount).status_code == 422


def test_a_double_tap_pays_once(client: TestClient, db_session: Session):
    top_up(client, "100.00")
    saved = save(client).json()
    same_key = key()

    first = pay(client, saved["id"], "30.00", same_key)
    second = pay(client, saved["id"], "30.00", same_key)

    assert first.json() == second.json()
    assert balance(client) == "70.00"
    assert len(client.get("/bills/payments").json()) == 1
    # One top-up and one bill in the ledger.
    assert db_session.scalar(select(func.count()).select_from(WalletTransfer)) == 2


def test_a_request_id_cannot_be_reused_for_something_else(client: TestClient):
    same_key = key()
    top_up(client, "100.00", same_key)
    saved = save(client).json()

    response = pay(client, saved["id"], "30.00", same_key)

    assert response.status_code == 409
    assert balance(client) == "100.00"


def test_a_receipt_survives_removing_the_saved_biller(client: TestClient):
    top_up(client, "100.00")
    saved = save(client).json()
    receipt = pay(client, saved["id"], "25.00").json()

    assert client.delete(f"/bills/saved/{saved['id']}").status_code == 204

    assert client.get("/bills/saved").json() == []
    assert client.get("/bills/payments").json() == [receipt]
    # The removed biller can no longer be paid.
    assert pay(client, saved["id"], "5.00").status_code == 404


def test_receipts_are_private_and_newest_first(client: TestClient, other_client: TestClient):
    top_up(client, "100.00")
    hydro = save(client).json()
    internet = save(client, biller_code="maplenet", account_number="9988-77").json()
    pay(client, hydro["id"], "10.00")
    pay(client, internet["id"], "20.00")

    assert [item["biller"]["name"] for item in client.get("/bills/payments").json()] == [
        "MapleNet",
        "Northern Hydro",
    ]
    assert other_client.get("/bills/payments").json() == []


def test_bill_money_leaves_the_app_and_the_ledger_still_adds_up(
    client: TestClient, db_session: Session
):
    top_up(client, "100.00")
    saved = save(client).json()
    pay(client, saved["id"], "40.00")

    assert total_of_all_wallets(db_session) == Decimal("0")
    assert balance(client) == "60.00"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/bills/billers"),
        ("GET", "/bills/saved"),
        ("POST", "/bills/saved"),
        ("DELETE", "/bills/saved/1"),
        ("POST", "/bills/pay"),
        ("GET", "/bills/payments"),
    ],
)
def test_every_bills_endpoint_requires_a_login(
    anonymous_client: TestClient, method: str, path: str
):
    assert anonymous_client.request(method, path).status_code == 401
