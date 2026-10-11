"""Each user can reach only their own receipts and expenses.

`client` is logged in as Sam and `other_client` as Alex. Sam creates the data;
the tests check what Alex, or a visitor who is not logged in, gets back.
"""

import pytest
from fastapi.testclient import TestClient

from tests.samples import encode, make_text_image
from tests.test_expenses import expense_payload


def create_expense(client: TestClient, **overrides) -> dict:
    return client.post("/expenses", json=expense_payload(**overrides)).json()


def upload_receipt(client: TestClient) -> dict:
    files = {"file": ("receipt.png", encode(make_text_image(), ".png"), "image/png")}
    return client.post("/receipts", files=files).json()


# --- not logged in ---


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/expenses"),
        ("POST", "/expenses"),
        ("GET", "/expenses/export.csv"),
        ("GET", "/expenses/1"),
        ("PUT", "/expenses/1"),
        ("DELETE", "/expenses/1"),
        ("POST", "/receipts"),
        ("GET", "/receipts/1"),
        ("POST", "/receipts/1/extract"),
        ("GET", "/receipts/1/image"),
        ("GET", "/stats/summary"),
    ],
)
def test_every_data_endpoint_requires_a_login(anonymous_client: TestClient, method: str, path: str):
    response = anonymous_client.request(method, path)

    assert response.status_code == 401


def test_health_check_stays_public(anonymous_client: TestClient):
    assert anonymous_client.get("/health").status_code == 200


# --- expenses ---


def test_a_user_sees_their_own_expense(client: TestClient):
    expense = create_expense(client)

    assert client.get(f"/expenses/{expense['id']}").status_code == 200
    assert len(client.get("/expenses").json()) == 1


def test_another_user_cannot_read_change_or_delete_the_expense(
    client: TestClient, other_client: TestClient
):
    expense = create_expense(client)
    url = f"/expenses/{expense['id']}"

    # 404, not 403: the answer does not even confirm that the expense exists.
    assert other_client.get(url).status_code == 404
    assert other_client.put(url, json=expense_payload(merchant="Hacked")).status_code == 404
    assert other_client.delete(url).status_code == 404
    # Sam's expense is untouched.
    assert client.get(url).json()["merchant"] == "Loblaws"


def test_lists_exports_and_stats_leave_out_other_users(
    client: TestClient, other_client: TestClient
):
    create_expense(client, merchant="Sam's shop", date="2026-10-05", total="45.20")

    assert other_client.get("/expenses").json() == []
    assert "Sam's shop" not in other_client.get("/expenses/export.csv").text
    summary = other_client.get("/stats/summary", params={"month": "2026-10"}).json()
    assert summary["month_total"] == "0.00"
    assert summary["expense_count"] == 0
    assert summary["top_merchants"] == []


def test_each_user_gets_their_own_totals(client: TestClient, other_client: TestClient):
    create_expense(client, date="2026-10-05", total="10.00")
    create_expense(other_client, date="2026-10-06", total="99.00")

    summary = client.get("/stats/summary", params={"month": "2026-10"}).json()

    assert summary["month_total"] == "10.00"


def test_the_owner_cannot_be_chosen_in_the_request(client: TestClient, other_client: TestClient):
    # A made-up user_id in the body is ignored; the session decides the owner.
    expense = client.post("/expenses", json=expense_payload() | {"user_id": 2}).json()

    assert client.get(f"/expenses/{expense['id']}").status_code == 200
    assert other_client.get(f"/expenses/{expense['id']}").status_code == 404


# --- receipts ---


def test_another_user_cannot_reach_the_receipt(client: TestClient, other_client: TestClient):
    receipt = upload_receipt(client)
    url = f"/receipts/{receipt['id']}"

    assert client.get(url).status_code == 200
    assert other_client.get(url).status_code == 404
    assert other_client.get(f"{url}/image").status_code == 404
    assert other_client.post(f"{url}/extract").status_code == 404


def test_an_expense_cannot_be_attached_to_another_users_receipt(
    client: TestClient, other_client: TestClient
):
    receipt = upload_receipt(client)

    response = other_client.post("/expenses", json=expense_payload(receipt_id=receipt["id"]))

    assert response.status_code == 404
    assert other_client.get("/expenses").json() == []
