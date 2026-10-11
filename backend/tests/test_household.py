"""Households, shared expenses and the balance between two members.

`client` is logged in as Sam and `other_client` as Alex.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.splitting import split_total
from tests.conftest import log_in_as
from tests.test_expenses import expense_payload

SAM = "sam@example.com"
ALEX = "alex@example.com"


def create_household(client: TestClient, name: str = "Apartment 4B") -> dict:
    return client.post("/household", json={"name": name}).json()


def share_household(client: TestClient, other_client: TestClient) -> dict:
    """Sam creates a household and Alex joins it."""
    household = create_household(client)
    return other_client.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    ).json()


def add_shared(client: TestClient, total: str, **overrides) -> dict:
    payload = expense_payload(total=total, subtotal=None, tax=None, is_shared=True, **overrides)
    return client.post("/expenses", json=payload).json()


def balance(client: TestClient, **params) -> dict:
    return client.get("/household/balance", params=params).json()


# --- splitting a total (plain functions, no database) ---


@pytest.mark.parametrize(
    ("total", "percent", "payer_part", "other_part"),
    [
        ("100.00", "50", "50.00", "50.00"),
        # An odd cent cannot be halved: the payer keeps it.
        ("10.01", "50", "5.01", "5.00"),
        ("0.01", "50", "0.01", "0.00"),
        # A third of 100 is 33.333...; the parts still add up to the total.
        ("100.00", "33.33", "33.33", "66.67"),
        ("19.99", "70", "13.99", "6.00"),
        # The payer covers nothing, or everything.
        ("42.50", "0", "0.00", "42.50"),
        ("42.50", "100", "42.50", "0.00"),
    ],
)
def test_split_total_rounds_to_cents_and_loses_nothing(
    total: str, percent: str, payer_part: str, other_part: str
):
    parts = split_total(Decimal(total), Decimal(percent))

    assert parts == (Decimal(payer_part), Decimal(other_part))
    assert sum(parts) == Decimal(total)


def test_split_total_rounds_half_a_cent_up():
    # 0.25 at 50% is exactly 0.125. Python's default would round that to 0.12.
    assert split_total(Decimal("0.25"), Decimal("50")) == (Decimal("0.13"), Decimal("0.12"))


def test_a_fixed_amount_is_used_instead_of_the_percent():
    # The other person owes exactly 20.00 of 33.33, whatever the percent says.
    parts = split_total(Decimal("33.33"), Decimal("50"), Decimal("20.00"))

    assert parts == (Decimal("13.33"), Decimal("20.00"))


# --- creating and joining ---


def test_create_household_makes_the_creator_its_only_member(client: TestClient):
    response = client.post("/household", json={"name": "  Apartment 4B  "})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Apartment 4B"
    assert len(body["invite_code"]) == 8
    assert [member["email"] for member in body["members"]] == [SAM]
    assert client.get("/household").json() == body


def test_no_household_gives_404(client: TestClient):
    assert client.get("/household").status_code == 404
    assert client.get("/household/balance").status_code == 404
    assert client.get("/household/expenses").status_code == 404


def test_household_endpoints_require_a_login(anonymous_client: TestClient):
    assert anonymous_client.get("/household").status_code == 401
    assert anonymous_client.post("/household", json={"name": "X"}).status_code == 401
    assert anonymous_client.get("/household/balance").status_code == 401


def test_join_with_the_invite_code(client: TestClient, other_client: TestClient):
    household = create_household(client)

    # Typed in lowercase with spaces around it: still accepted.
    code = f"  {household['invite_code'].lower()} "
    response = other_client.post("/household/join", json={"invite_code": code})

    assert response.status_code == 200
    assert [member["email"] for member in response.json()["members"]] == [SAM, ALEX]
    # Members never see each other's password hash.
    assert "password" not in response.text


def test_join_with_a_wrong_code_gives_404(client: TestClient, other_client: TestClient):
    create_household(client)

    response = other_client.post("/household/join", json={"invite_code": "WRONGCODE"})

    assert response.status_code == 404


def test_a_user_can_only_be_in_one_household(client: TestClient, other_client: TestClient):
    household = share_household(client, other_client)

    assert client.post("/household", json={"name": "Second"}).status_code == 409
    join_again = other_client.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    )
    assert join_again.status_code == 409


def test_a_third_person_cannot_join(
    client: TestClient, other_client: TestClient, db_session: Session
):
    household = share_household(client, other_client)
    third_client = TestClient(app)
    log_in_as(third_client, db_session, "third@example.com")

    response = third_client.post("/household/join", json={"invite_code": household["invite_code"]})

    assert response.status_code == 409
    assert response.json()["detail"] == "This household is already full"


def test_leaving_keeps_the_household_until_the_last_member_goes(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)

    assert other_client.post("/household/leave").status_code == 204
    assert other_client.get("/household").status_code == 404
    assert [member["email"] for member in client.get("/household").json()["members"]] == [SAM]

    assert client.post("/household/leave").status_code == 204
    assert client.get("/household").status_code == 404


# --- shared expenses ---


def test_expenses_are_private_unless_marked_shared(client: TestClient):
    expense = client.post("/expenses", json=expense_payload()).json()

    assert expense["is_shared"] is False
    assert expense["payer_share_percent"] == "50.00"


def test_share_percent_must_be_between_0_and_100(client: TestClient):
    for bad in ("-1", "100.01", "abc"):
        response = client.post("/expenses", json=expense_payload(payer_share_percent=bad))
        assert response.status_code == 422


def test_members_see_each_others_shared_expenses_only(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00", merchant="Rent", date="2026-10-01")
    add_shared(other_client, "60.00", merchant="Internet", date="2026-10-03")
    client.post("/expenses", json=expense_payload(merchant="Sam's private lunch"))

    shared = other_client.get("/household/expenses").json()

    # Newest first, with who paid and how each one is split.
    assert [(item["merchant"], item["paid_by"]["email"]) for item in shared] == [
        ("Internet", ALEX),
        ("Rent", SAM),
    ]
    assert shared[1]["payer_part"] == "50.00"
    assert shared[1]["other_part"] == "50.00"


def test_the_other_member_still_cannot_change_a_shared_expense(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    expense = add_shared(client, "100.00")

    # Sharing lets Alex see it in the household list, not edit or delete it.
    assert other_client.delete(f"/expenses/{expense['id']}").status_code == 404
    assert other_client.get(f"/expenses/{expense['id']}").status_code == 404


# --- balance ---


def test_balance_is_zero_with_no_shared_expenses(client: TestClient, other_client: TestClient):
    share_household(client, other_client)

    assert balance(client) == {
        "currency": "CAD",
        "amount": "0.00",
        "owed_by": None,
        "owed_to": None,
        "shared_expense_count": 0,
    }


def test_the_other_member_owes_half_of_what_one_paid(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00")

    result = balance(client)

    assert result["amount"] == "50.00"
    assert result["owed_by"]["email"] == ALEX
    assert result["owed_to"]["email"] == SAM
    # Both members get the same answer.
    assert balance(other_client) == result


def test_what_each_paid_is_set_against_the_other(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00")  # Alex owes Sam 50.00
    add_shared(other_client, "160.00")  # Sam owes Alex 80.00

    result = balance(client)

    assert result["amount"] == "30.00"
    assert result["owed_by"]["email"] == SAM
    assert result["owed_to"]["email"] == ALEX
    assert result["shared_expense_count"] == 2


def test_equal_spending_settles_to_zero(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "80.00")
    add_shared(other_client, "80.00")

    result = balance(client)

    assert result["amount"] == "0.00"
    assert result["owed_by"] is None
    assert result["owed_to"] is None


def test_balance_uses_each_expenses_own_split(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    # Sam pays the rent but has the bigger room, so covers 60% himself.
    add_shared(client, "1500.00", payer_share_percent="60")

    assert balance(client)["amount"] == "600.00"


def test_balance_uses_a_fixed_amount_when_one_is_given(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    # Groceries were 87.40, and Alex's items came to exactly 31.15.
    expense = add_shared(client, "87.40", other_share_amount="31.15")

    assert expense["other_share_amount"] == "31.15"
    assert balance(client)["amount"] == "31.15"
    shared = client.get("/household/expenses").json()[0]
    assert (shared["payer_part"], shared["other_part"]) == ("56.25", "31.15")


def test_the_fixed_amount_cannot_be_more_than_the_total(client: TestClient):
    payload = expense_payload(total="50.00", subtotal=None, tax=None, other_share_amount="50.01")

    response = client.post("/expenses", json=payload)

    assert response.status_code == 422
    # The whole total is allowed: the other person owes all of it.
    payload["other_share_amount"] = "50.00"
    assert client.post("/expenses", json=payload).status_code == 201


def test_clearing_the_fixed_amount_goes_back_to_the_percent(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    expense = add_shared(client, "100.00", other_share_amount="10.00")

    client.put(
        f"/expenses/{expense['id']}",
        json=expense_payload(total="100.00", subtotal=None, tax=None, is_shared=True),
    )

    assert balance(client)["amount"] == "50.00"


def test_balance_rounds_each_expense_and_adds_exact_cents(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    # Three odd totals: Alex's parts are 5.00 + 0.16 + 3.33 = 8.49 exactly.
    add_shared(client, "10.01")
    add_shared(client, "0.33")
    add_shared(client, "6.67")

    assert balance(client)["amount"] == "8.49"


def test_balance_ignores_unshared_expenses_and_other_currencies(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    add_shared(client, "100.00")
    add_shared(client, "40.00", currency="USD")
    client.post("/expenses", json=expense_payload(total="999.00", subtotal=None, tax=None))

    assert balance(client)["amount"] == "50.00"
    assert balance(client, currency="USD")["amount"] == "20.00"


def test_unsharing_an_expense_removes_it_from_the_balance(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    expense = add_shared(client, "100.00")

    client.put(
        f"/expenses/{expense['id']}",
        json=expense_payload(total="100.00", subtotal=None, tax=None, is_shared=False),
    )

    assert balance(client)["amount"] == "0.00"


def test_balance_alone_in_a_household_is_zero(client: TestClient):
    create_household(client)
    add_shared(client, "100.00")

    result = balance(client)

    assert result["amount"] == "0.00"
    assert result["owed_by"] is None
    assert result["shared_expense_count"] == 1


def test_people_outside_the_household_are_not_counted(
    client: TestClient, other_client: TestClient, db_session: Session
):
    share_household(client, other_client)
    outsider = TestClient(app)
    log_in_as(outsider, db_session, "outsider@example.com")
    add_shared(outsider, "500.00")

    assert balance(client)["amount"] == "0.00"
    assert client.get("/household/expenses").json() == []
