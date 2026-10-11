"""Connecting a (sandbox) bank and importing its transactions.

No test talks to Plaid. The API tests use FakeBankClient, and the tests of
PlaidClient itself answer its HTTP requests with a mock transport.
"""

import datetime
import json
from decimal import Decimal

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.bank import BankError, BankTransactionData, SyncResult, get_bank_client
from app.bank.categories import suggest_category
from app.bank.plaid import PLAID_SANDBOX_URL, PlaidClient
from app.config import Settings, get_settings
from app.enums import Category
from app.main import app
from app.models import BankConnection, BankTransaction


def transaction(transaction_id: str, name: str = "Starbucks", amount: str = "4.33", **overrides):
    values = {
        "transaction_id": transaction_id,
        "name": name,
        "amount": Decimal(amount),
        "currency": "USD",
        "date": datetime.date(2026, 10, 5),
        "pending": False,
        "category": "FOOD_AND_DRINK",
        "detailed_category": "FOOD_AND_DRINK_COFFEE",
    }
    return BankTransactionData(**{**values, **overrides})


class FakeBankClient:
    """Stands in for Plaid. Tests queue what each sync returns."""

    def __init__(self) -> None:
        self.error: BankError | None = None
        self.sync_results: list[SyncResult] = []
        self.cursors_seen: list[str | None] = []

    def create_link_token(self, user_id: int) -> str:
        if self.error is not None:
            raise self.error
        return f"link-sandbox-for-user-{user_id}"

    def exchange_public_token(self, public_token: str) -> tuple[str, str]:
        if self.error is not None:
            raise self.error
        return f"access-for-{public_token}", f"item-for-{public_token}"

    def sync_transactions(self, access_token: str, cursor: str | None) -> SyncResult:
        self.cursors_seen.append(cursor)
        if self.error is not None:
            raise self.error
        # Nothing queued means nothing new at the bank.
        return (
            self.sync_results.pop(0) if self.sync_results else SyncResult(next_cursor=cursor or "")
        )


@pytest.fixture
def fake_bank(client: TestClient) -> FakeBankClient:
    """Replaces the Plaid client for this test. The `client` fixture undoes it afterwards."""
    fake = FakeBankClient()
    app.dependency_overrides[get_bank_client] = lambda: fake
    return fake


def connect(client: TestClient, public_token: str = "public-1", name: str = "First Platypus Bank"):
    return client.post(
        "/bank/connections", json={"public_token": public_token, "institution_name": name}
    )


def waiting(client: TestClient) -> list[dict]:
    return client.get("/bank/transactions").json()


# --- category suggestions ---


@pytest.mark.parametrize(
    ("primary", "detailed", "expected"),
    [
        ("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", Category.DINING),
        ("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", Category.GROCERIES),
        ("TRANSPORTATION", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", Category.TRANSPORT),
        ("RENT_AND_UTILITIES", None, Category.BILLS_UTILITIES),
        ("MEDICAL", None, Category.HEALTH),
        ("SOMETHING_NEW", None, Category.OTHER),
        (None, None, Category.OTHER),
    ],
)
def test_suggest_category(primary: str | None, detailed: str | None, expected: Category):
    assert suggest_category(primary, detailed) is expected


# --- status and connecting ---


def test_status_says_when_the_keys_are_missing(client: TestClient, fake_bank: FakeBankClient):
    # The test settings have no Plaid keys.
    assert client.get("/bank/status").json() == {"configured": False, "connections": []}


def test_status_says_when_the_keys_are_set(client: TestClient, fake_bank: FakeBankClient):
    app.dependency_overrides[get_settings] = lambda: Settings(
        plaid_client_id="test-id", plaid_secret="test-secret"
    )

    assert client.get("/bank/status").json()["configured"] is True


def test_a_link_token_is_made_for_the_logged_in_user(client: TestClient, fake_bank: FakeBankClient):
    user_id = client.get("/auth/me").json()["id"]

    response = client.post("/bank/link-token")

    assert response.json() == {"link_token": f"link-sandbox-for-user-{user_id}"}


def test_connecting_stores_the_bank_and_never_returns_the_access_token(
    client: TestClient, fake_bank: FakeBankClient, db_session: Session
):
    response = connect(client)

    assert response.status_code == 201
    assert response.json()["institution_name"] == "First Platypus Bank"
    assert "access" not in response.text
    assert "access" not in client.get("/bank/status").text
    stored = db_session.scalar(select(BankConnection))
    assert stored.access_token == "access-for-public-1"
    assert stored.item_id == "item-for-public-1"


def test_a_provider_failure_becomes_a_clear_502(client: TestClient, fake_bank: FakeBankClient):
    fake_bank.error = BankError("Could not reach the bank service.")

    for response in (client.post("/bank/link-token"), connect(client)):
        assert response.status_code == 502
        assert response.json() == {"detail": "Could not reach the bank service."}


# --- importing ---


def test_sync_imports_purchases_for_review(client: TestClient, fake_bank: FakeBankClient):
    connect(client)
    fake_bank.sync_results = [
        SyncResult(
            added=[
                transaction("t1", "Starbucks", "4.33"),
                transaction(
                    "t2",
                    "Whole Foods",
                    "89.40",
                    date=datetime.date(2026, 10, 7),
                    detailed_category="FOOD_AND_DRINK_GROCERIES",
                ),
            ],
            next_cursor="cursor-1",
        )
    ]

    summary = client.post("/bank/sync").json()

    assert summary == {"imported": 2, "removed": 0}
    listed = waiting(client)
    # Newest first, with a suggested category, and not yet an expense.
    assert [(item["name"], item["amount"], item["category"]) for item in listed] == [
        ("Whole Foods", "89.40", "Groceries"),
        ("Starbucks", "4.33", "Dining"),
    ]
    assert all(item["status"] == "new" and item["expense_id"] is None for item in listed)
    assert client.get("/expenses").json() == []


def test_importing_twice_does_not_duplicate(client: TestClient, fake_bank: FakeBankClient):
    connect(client)
    same = SyncResult(added=[transaction("t1"), transaction("t2")], next_cursor="cursor-1")
    # The bank returns the very same transactions on both syncs.
    fake_bank.sync_results = [same, same]

    first = client.post("/bank/sync").json()
    second = client.post("/bank/sync").json()

    assert first["imported"] == 2
    assert second["imported"] == 0
    assert len(waiting(client)) == 2


def test_the_cursor_is_saved_and_sent_on_the_next_sync(
    client: TestClient, fake_bank: FakeBankClient
):
    connect(client)
    fake_bank.sync_results = [SyncResult(added=[transaction("t1")], next_cursor="cursor-1")]

    client.post("/bank/sync")
    client.post("/bank/sync")

    # None the first time (import everything), then the bookmark from before.
    assert fake_bank.cursors_seen == [None, "cursor-1"]


def test_deposits_refunds_and_pending_transactions_are_not_imported(
    client: TestClient, fake_bank: FakeBankClient
):
    connect(client)
    fake_bank.sync_results = [
        SyncResult(
            added=[
                transaction("pay", "Payroll", "-2500.00"),
                transaction("refund", "Amazon refund", "-19.99"),
                transaction("zero", "Adjustment", "0.00"),
                transaction("soon", "Uber", "12.00", pending=True),
                transaction("real", "Uber", "12.00"),
            ],
            next_cursor="cursor-1",
        )
    ]

    assert client.post("/bank/sync").json()["imported"] == 1
    assert [item["name"] for item in waiting(client)] == ["Uber"]


def test_a_transaction_the_bank_withdraws_is_dropped_if_still_waiting(
    client: TestClient, fake_bank: FakeBankClient
):
    connect(client)
    fake_bank.sync_results = [
        SyncResult(added=[transaction("t1"), transaction("t2", "Uber")], next_cursor="cursor-1"),
        SyncResult(removed_ids=["t1", "t2"], next_cursor="cursor-2"),
    ]
    client.post("/bank/sync")
    # t2 is added to the expenses before the bank withdraws it.
    uber = next(item for item in waiting(client) if item["name"] == "Uber")
    client.post(f"/bank/transactions/{uber['id']}/add", json={})

    summary = client.post("/bank/sync").json()

    assert summary == {"imported": 0, "removed": 1}
    assert waiting(client) == []
    # The expense that was already made is kept.
    assert len(client.get("/expenses").json()) == 1


def test_a_missing_currency_falls_back_to_the_app_default(
    client: TestClient, fake_bank: FakeBankClient
):
    connect(client)
    fake_bank.sync_results = [SyncResult(added=[transaction("t1", currency=None)])]

    client.post("/bank/sync")

    assert waiting(client)[0]["currency"] == "CAD"


def test_a_failed_sync_reports_the_problem(client: TestClient, fake_bank: FakeBankClient):
    connect(client)
    fake_bank.error = BankError("This bank connection has expired.")

    response = client.post("/bank/sync")

    assert response.status_code == 502
    assert response.json()["detail"] == "This bank connection has expired."


def test_sync_with_no_bank_connected_does_nothing(client: TestClient, fake_bank: FakeBankClient):
    assert client.post("/bank/sync").json() == {"imported": 0, "removed": 0}
    assert fake_bank.cursors_seen == []


# --- reviewing ---


def imported_one(client: TestClient, fake_bank: FakeBankClient) -> dict:
    connect(client)
    fake_bank.sync_results = [SyncResult(added=[transaction("t1")], next_cursor="cursor-1")]
    client.post("/bank/sync")
    return waiting(client)[0]


def test_adding_a_transaction_makes_an_expense(client: TestClient, fake_bank: FakeBankClient):
    item = imported_one(client, fake_bank)

    response = client.post(f"/bank/transactions/{item['id']}/add", json={})

    assert response.status_code == 200
    expense = response.json()
    assert (expense["merchant"], expense["total"], expense["date"]) == (
        "Starbucks",
        "4.33",
        "2026-10-05",
    )
    assert expense["category"] == "Dining"
    assert expense["currency"] == "USD"
    assert expense["notes"] == "Imported from First Platypus Bank"
    # It leaves the review list and is now marked as added.
    assert waiting(client) == []
    added = client.get("/bank/transactions", params={"status": "added"}).json()
    assert added[0]["expense_id"] == expense["id"]


def test_the_category_can_be_changed_when_adding(client: TestClient, fake_bank: FakeBankClient):
    item = imported_one(client, fake_bank)

    expense = client.post(
        f"/bank/transactions/{item['id']}/add", json={"category": "Entertainment"}
    ).json()

    assert expense["category"] == "Entertainment"


def test_a_transaction_cannot_be_added_twice(client: TestClient, fake_bank: FakeBankClient):
    item = imported_one(client, fake_bank)
    client.post(f"/bank/transactions/{item['id']}/add", json={})

    again = client.post(f"/bank/transactions/{item['id']}/add", json={})

    assert again.status_code == 409
    assert len(client.get("/expenses").json()) == 1


def test_ignoring_a_transaction_hides_it_without_making_an_expense(
    client: TestClient, fake_bank: FakeBankClient
):
    item = imported_one(client, fake_bank)

    response = client.post(f"/bank/transactions/{item['id']}/ignore")

    assert response.json()["status"] == "ignored"
    assert waiting(client) == []
    assert client.get("/expenses").json() == []
    # A later import of the same transaction does not bring it back.
    fake_bank.sync_results = [SyncResult(added=[transaction("t1")], next_cursor="cursor-2")]
    assert client.post("/bank/sync").json()["imported"] == 0
    assert waiting(client) == []


def test_removing_a_bank_drops_its_waiting_transactions_but_keeps_expenses(
    client: TestClient, fake_bank: FakeBankClient, db_session: Session
):
    connection = connect(client).json()
    fake_bank.sync_results = [SyncResult(added=[transaction("t1"), transaction("t2")])]
    client.post("/bank/sync")
    client.post(f"/bank/transactions/{waiting(client)[0]['id']}/add", json={})

    assert client.delete(f"/bank/connections/{connection['id']}").status_code == 204

    assert client.get("/bank/status").json()["connections"] == []
    assert db_session.scalar(select(BankTransaction)) is None
    assert len(client.get("/expenses").json()) == 1


# --- ownership ---


def test_bank_data_belongs_to_its_owner(
    client: TestClient, other_client: TestClient, fake_bank: FakeBankClient
):
    item = imported_one(client, fake_bank)
    connection_id = client.get("/bank/status").json()["connections"][0]["id"]

    assert other_client.get("/bank/status").json()["connections"] == []
    assert other_client.get("/bank/transactions").json() == []
    assert other_client.post(f"/bank/transactions/{item['id']}/add", json={}).status_code == 404
    assert other_client.post(f"/bank/transactions/{item['id']}/ignore").status_code == 404
    assert other_client.delete(f"/bank/connections/{connection_id}").status_code == 404
    # Alex's sync does not touch Sam's bank.
    assert other_client.post("/bank/sync").json() == {"imported": 0, "removed": 0}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/bank/status"),
        ("POST", "/bank/link-token"),
        ("POST", "/bank/connections"),
        ("DELETE", "/bank/connections/1"),
        ("POST", "/bank/sync"),
        ("GET", "/bank/transactions"),
        ("POST", "/bank/transactions/1/add"),
        ("POST", "/bank/transactions/1/ignore"),
    ],
)
def test_every_bank_endpoint_requires_a_login(anonymous_client: TestClient, method: str, path: str):
    assert anonymous_client.request(method, path).status_code == 401


# --- the Plaid client itself (HTTP answered by a mock, nothing leaves the machine) ---


def plaid_with(handler) -> tuple[PlaidClient, list[httpx2.Request]]:
    """A PlaidClient whose requests are answered by `handler`, and a list of what it sent."""
    sent: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return handler(request)

    return PlaidClient("test-id", "test-secret", transport=httpx2.MockTransport(record)), sent


def test_the_client_only_ever_talks_to_the_sandbox():
    client, sent = plaid_with(lambda request: httpx2.Response(200, json={"link_token": "link-1"}))

    client.create_link_token(user_id=7)

    assert PLAID_SANDBOX_URL == "https://sandbox.plaid.com"
    assert str(sent[0].url) == "https://sandbox.plaid.com/link/token/create"
    # No setting can point the app at Plaid's real-bank address.
    assert not any("plaid_env" in name or "plaid_url" in name for name in Settings.model_fields)


def test_every_request_carries_the_keys_in_its_body():
    client, sent = plaid_with(lambda request: httpx2.Response(200, json={"link_token": "link-1"}))

    assert client.create_link_token(user_id=7) == "link-1"

    body = json.loads(sent[0].content)
    assert body["client_id"] == "test-id"
    assert body["secret"] == "test-secret"
    assert body["user"] == {"client_user_id": "7"}
    assert body["products"] == ["transactions"]


def test_exchange_returns_the_access_token_and_item_id():
    client, sent = plaid_with(
        lambda request: httpx2.Response(200, json={"access_token": "access-1", "item_id": "item-1"})
    )

    assert client.exchange_public_token("public-1") == ("access-1", "item-1")
    assert json.loads(sent[0].content)["public_token"] == "public-1"


PLAID_TRANSACTION = {
    "transaction_id": "t1",
    "name": "SBUX 0423 TORONTO",
    "merchant_name": "Starbucks",
    "amount": 4.33,
    "iso_currency_code": "USD",
    "date": "2026-10-05",
    "pending": False,
    "personal_finance_category": {
        "primary": "FOOD_AND_DRINK",
        "detailed": "FOOD_AND_DRINK_COFFEE",
    },
}


def test_sync_follows_the_pages_until_there_are_no_more():
    pages = [
        {"added": [PLAID_TRANSACTION], "removed": [], "next_cursor": "c1", "has_more": True},
        {
            "added": [{**PLAID_TRANSACTION, "transaction_id": "t2", "merchant_name": None}],
            "removed": [{"transaction_id": "old"}],
            "next_cursor": "c2",
            "has_more": False,
        },
    ]
    client, sent = plaid_with(lambda request: httpx2.Response(200, json=pages.pop(0)))

    result = client.sync_transactions("access-1", cursor=None)

    assert [item.transaction_id for item in result.added] == ["t1", "t2"]
    assert result.removed_ids == ["old"]
    assert result.next_cursor == "c2"
    # The first request has no cursor; the second continues from the first page.
    assert "cursor" not in json.loads(sent[0].content)
    assert json.loads(sent[1].content)["cursor"] == "c1"


def test_a_plaid_transaction_is_read_without_float_errors():
    client, _ = plaid_with(
        lambda request: httpx2.Response(
            200, json={"added": [PLAID_TRANSACTION], "next_cursor": "c1", "has_more": False}
        )
    )

    item = client.sync_transactions("access-1", cursor="c0").added[0]

    assert item.name == "Starbucks"
    assert item.amount == Decimal("4.33")
    assert item.date == datetime.date(2026, 10, 5)
    assert (item.category, item.detailed_category) == ("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE")


def test_missing_keys_are_explained_before_any_request_is_sent():
    sent: list[httpx2.Request] = []
    client = PlaidClient("", "", transport=httpx2.MockTransport(lambda r: sent.append(r)))

    with pytest.raises(BankError, match="PLAID_CLIENT_ID and PLAID_SECRET"):
        client.create_link_token(user_id=1)
    assert sent == []


@pytest.mark.parametrize(
    ("error_code", "message"),
    [
        ("INVALID_API_KEYS", "rejected the keys"),
        ("ITEM_LOGIN_REQUIRED", "has expired"),
        ("SOMETHING_ELSE", r"returned an error \(SOMETHING_ELSE\)"),
    ],
)
def test_plaid_errors_become_clear_messages(error_code: str, message: str):
    client, _ = plaid_with(
        lambda request: httpx2.Response(400, json={"error_code": error_code, "error_message": "x"})
    )

    with pytest.raises(BankError, match=message):
        client.sync_transactions("access-1", cursor=None)


def test_a_network_failure_becomes_a_clear_message():
    def fail(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("no route to host")

    client, _ = plaid_with(fail)

    with pytest.raises(BankError, match="Could not reach the bank service"):
        client.create_link_token(user_id=1)


def test_an_error_never_contains_the_secret():
    client, _ = plaid_with(lambda request: httpx2.Response(500, text="upstream exploded"))

    with pytest.raises(BankError) as raised:
        client.create_link_token(user_id=1)

    assert "test-secret" not in str(raised.value)
