"""Households, shared expenses and the balance between members.

`client` is logged in as Sam and `other_client` as Alex. Tests that need a
bigger household add Jo and Kim with `third_client` and `fourth_client`.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models import Expense, ExpenseShare
from app.splitting import net_balances, plan_payments, split_equally
from tests.conftest import log_in_as
from tests.test_expenses import expense_payload

SAM = "sam@example.com"
ALEX = "alex@example.com"
JO = "jo@example.com"
KIM = "kim@example.com"


@pytest.fixture
def third_client(other_client: TestClient, db_session: Session) -> TestClient:
    third = TestClient(app)
    log_in_as(third, db_session, JO)
    return third


@pytest.fixture
def fourth_client(third_client: TestClient, db_session: Session) -> TestClient:
    fourth = TestClient(app)
    log_in_as(fourth, db_session, KIM)
    return fourth


def create_household(client: TestClient, name: str = "Apartment 4B") -> dict:
    return client.post("/household", json={"name": name}).json()


def share_household(creator: TestClient, *joiners: TestClient) -> dict[str, int]:
    """The first client creates a household and the others join it.

    Returns the members' ids by email, which the tests need to name shares.
    """
    household = create_household(creator)
    for joiner in joiners:
        household = joiner.post(
            "/household/join", json={"invite_code": household["invite_code"]}
        ).json()
    return {member["email"]: member["id"] for member in household["members"]}


def add_shared(client: TestClient, total: str, shares: dict[int, str] | None = None, **overrides):
    """Add a shared expense. Without `shares` it is split equally among everyone."""
    payload = expense_payload(total=total, subtotal=None, tax=None, is_shared=True, **overrides)
    if shares is not None:
        payload["shares"] = [
            {"user_id": user_id, "amount": amount} for user_id, amount in shares.items()
        ]
    return client.post("/expenses", json=payload)


def balance(client: TestClient, **params) -> dict:
    return client.get("/household/balance", params=params).json()


def nets(client: TestClient, **params) -> dict[str, str]:
    """Each member's net position by email."""
    return {
        entry["member"]["email"]: entry["net"] for entry in balance(client, **params)["members"]
    }


def payments(client: TestClient, **params) -> list[tuple[str, str, str]]:
    """The suggested payments as (from, to, amount)."""
    return [
        (payment["owed_by"]["email"], payment["owed_to"]["email"], payment["amount"])
        for payment in balance(client, **params)["payments"]
    ]


# --- splitting a total (plain functions, no database) ---


@pytest.mark.parametrize(
    ("total", "people", "parts"),
    [
        ("100.00", 2, ["50.00", "50.00"]),
        # An odd cent cannot be halved: the first person takes it.
        ("10.01", 2, ["5.01", "5.00"]),
        ("10.00", 3, ["3.34", "3.33", "3.33"]),
        # Two cents left over: the first two people take one each.
        ("10.00", 6, ["1.67", "1.67", "1.67", "1.67", "1.66", "1.66"]),
        ("0.01", 4, ["0.01", "0.00", "0.00", "0.00"]),
        ("2000.00", 4, ["500.00", "500.00", "500.00", "500.00"]),
        ("42.50", 1, ["42.50"]),
    ],
)
def test_split_equally_loses_no_cent(total: str, people: int, parts: list[str]):
    result = split_equally(Decimal(total), people)

    assert result == [Decimal(part) for part in parts]
    assert sum(result) == Decimal(total)


def make_expense(payer: int, shares: dict[int, str]) -> Expense:
    """An unsaved expense, enough for the balance functions."""
    return Expense(
        user_id=payer,
        shares=[
            ExpenseShare(user_id=user, amount=Decimal(amount)) for user, amount in shares.items()
        ],
    )


def test_net_balances_always_add_up_to_zero():
    expenses = [
        make_expense(1, {1: "30.00", 2: "30.00", 3: "30.00"}),
        make_expense(2, {1: "12.50", 3: "7.49"}),
        make_expense(3, {3: "5.00"}),  # only the payer's own part: nobody owes anything
    ]

    result = net_balances([1, 2, 3], expenses)

    assert result == {1: Decimal("47.50"), 2: Decimal("-10.01"), 3: Decimal("-37.49")}
    assert sum(result.values()) == 0


def test_net_balances_leave_out_people_who_are_not_members():
    expenses = [
        make_expense(1, {1: "10.00", 2: "10.00", 99: "10.00"}),
        make_expense(99, {1: "5.00"}),
    ]

    assert net_balances([1, 2], expenses) == {1: Decimal("10.00"), 2: Decimal("-10.00")}


def test_plan_payments_settles_everyone_in_few_payments():
    # 1 is owed 70; 2, 3 and 4 owe 40, 20 and 10.
    balances = {1: Decimal("70"), 2: Decimal("-40"), 3: Decimal("-20"), 4: Decimal("-10")}

    assert plan_payments(balances) == [
        (2, 1, Decimal("40")),
        (3, 1, Decimal("20")),
        (4, 1, Decimal("10")),
    ]


def test_plan_payments_nets_debts_through_the_group():
    # 3 owes 50 in total and 1 and 2 are owed 30 and 20. Who bought what does
    # not matter: two payments settle it.
    balances = {1: Decimal("30"), 2: Decimal("20"), 3: Decimal("-50")}

    assert plan_payments(balances) == [(3, 1, Decimal("30")), (3, 2, Decimal("20"))]


def test_plan_payments_is_empty_when_everyone_is_even():
    assert plan_payments({1: Decimal("0"), 2: Decimal("0")}) == []


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


def test_a_household_can_have_more_than_two_members(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,
    fourth_client: TestClient,
):
    members = share_household(client, other_client, third_client, fourth_client)

    assert list(members) == [SAM, ALEX, JO, KIM]


def test_join_with_a_wrong_code_gives_404(client: TestClient, other_client: TestClient):
    create_household(client)

    response = other_client.post("/household/join", json={"invite_code": "WRONGCODE"})

    assert response.status_code == 404


def test_a_user_can_only_be_in_one_household(client: TestClient, other_client: TestClient):
    household = create_household(client)
    other_client.post("/household/join", json={"invite_code": household["invite_code"]})

    assert client.post("/household", json={"name": "Second"}).status_code == 409
    join_again = other_client.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    )
    assert join_again.status_code == 409


def test_a_full_household_cannot_be_joined(
    client: TestClient, other_client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    # Lower the limit for this test instead of creating twenty users.
    monkeypatch.setattr("app.routers.household.MAX_MEMBERS", 1)
    household = create_household(client)

    response = other_client.post("/household/join", json={"invite_code": household["invite_code"]})

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


# --- sharing an expense ---


def test_expenses_are_private_unless_marked_shared(client: TestClient):
    expense = client.post("/expenses", json=expense_payload()).json()

    assert expense["is_shared"] is False
    assert expense["shares"] == []


def test_sharing_needs_a_household(client: TestClient):
    response = add_shared(client, "100.00")

    assert response.status_code == 409
    assert client.get("/expenses").json() == []


def test_a_shared_expense_is_split_equally_among_everyone_by_default(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,
    fourth_client: TestClient,
):
    members = share_household(client, other_client, third_client, fourth_client)

    expense = add_shared(client, "2000.00", merchant="Rent").json()

    assert expense["is_shared"] is True
    assert expense["shares"] == [
        {"user_id": members[email], "amount": "500.00"} for email in (SAM, ALEX, JO, KIM)
    ]


def test_the_payer_takes_the_cent_that_cannot_be_divided(
    client: TestClient, other_client: TestClient, third_client: TestClient
):
    members = share_household(client, other_client, third_client)

    # Alex pays 10.00 for three people: 3.34 + 3.33 + 3.33.
    expense = add_shared(other_client, "10.00").json()

    parts = {share["user_id"]: share["amount"] for share in expense["shares"]}
    assert parts == {members[ALEX]: "3.34", members[SAM]: "3.33", members[JO]: "3.33"}


def test_an_expense_can_be_shared_by_only_some_members(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,
    fourth_client: TestClient,
):
    members = share_household(client, other_client, third_client, fourth_client)

    # Sam paid 24.00 for a pizza that only Sam and Jo ate.
    expense = add_shared(client, "24.00", {members[SAM]: "12.00", members[JO]: "12.00"}).json()

    assert [share["user_id"] for share in expense["shares"]] == [members[SAM], members[JO]]
    assert nets(client) == {SAM: "12.00", ALEX: "0.00", JO: "-12.00", KIM: "0.00"}


def test_shares_can_be_exact_amounts(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)

    # Groceries were 87.40 and Alex's items came to exactly 31.15.
    add_shared(client, "87.40", {members[SAM]: "56.25", members[ALEX]: "31.15"})

    assert payments(client) == [(ALEX, SAM, "31.15")]


def test_the_payer_does_not_need_a_share(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)

    # Sam picked up something that was entirely for Alex.
    add_shared(client, "40.00", {members[ALEX]: "40.00"})

    assert payments(client) == [(ALEX, SAM, "40.00")]


@pytest.mark.parametrize(
    ("amounts", "problem"),
    [
        (("60.00", "39.99"), "add up to the total"),
        (("60.00", "40.01"), "add up to the total"),
        (("-1.00", "101.00"), "greater than or equal to 0"),
    ],
)
def test_shares_must_add_up_to_the_total(
    client: TestClient, other_client: TestClient, amounts: tuple[str, str], problem: str
):
    members = share_household(client, other_client)

    response = add_shared(client, "100.00", {members[SAM]: amounts[0], members[ALEX]: amounts[1]})

    assert response.status_code == 422
    assert problem in response.text


def test_a_person_cannot_have_two_shares(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    payload = expense_payload(total="10.00", subtotal=None, tax=None, is_shared=True)
    payload["shares"] = [{"user_id": members[ALEX], "amount": "5.00"}] * 2

    assert client.post("/expenses", json=payload).status_code == 422


def test_shares_cannot_go_to_someone_outside_the_household(
    client: TestClient, other_client: TestClient, third_client: TestClient
):
    members = share_household(client, other_client)
    outsider_id = third_client.get("/auth/me").json()["id"]

    response = add_shared(client, "10.00", {members[SAM]: "5.00", outsider_id: "5.00"})

    assert response.status_code == 422
    assert client.get("/expenses").json() == []


def test_editing_a_shared_expense_replaces_its_shares(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    expense = add_shared(client, "100.00").json()

    payload = expense_payload(total="100.00", subtotal=None, tax=None, is_shared=True)
    payload["shares"] = [
        {"user_id": members[SAM], "amount": "70.00"},
        {"user_id": members[ALEX], "amount": "30.00"},
    ]
    updated = client.put(f"/expenses/{expense['id']}", json=payload).json()

    assert [share["amount"] for share in updated["shares"]] == ["70.00", "30.00"]
    assert payments(client) == [(ALEX, SAM, "30.00")]


def test_unsharing_an_expense_removes_it_from_the_balance(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    expense = add_shared(client, "100.00").json()

    payload = expense_payload(total="100.00", subtotal=None, tax=None, is_shared=False)
    updated = client.put(f"/expenses/{expense['id']}", json=payload).json()

    assert updated["is_shared"] is False
    assert updated["shares"] == []
    assert payments(client) == []
    assert client.get("/household/expenses").json() == []


# --- the household's list of shared expenses ---


def test_members_see_each_others_shared_expenses_only(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00", merchant="Rent", date="2026-10-01")
    add_shared(other_client, "60.00", merchant="Internet", date="2026-10-03")
    client.post("/expenses", json=expense_payload(merchant="Sam's private lunch"))

    shared = other_client.get("/household/expenses").json()

    # Newest first, with who paid.
    assert [(item["merchant"], item["paid_by"]["email"]) for item in shared] == [
        ("Internet", ALEX),
        ("Rent", SAM),
    ]
    assert [share["amount"] for share in shared[1]["shares"]] == ["50.00", "50.00"]


def test_another_member_still_cannot_change_a_shared_expense(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    expense = add_shared(client, "100.00").json()

    # Sharing lets Alex see it in the household list, not edit or delete it.
    assert other_client.delete(f"/expenses/{expense['id']}").status_code == 404
    assert other_client.get(f"/expenses/{expense['id']}").status_code == 404


def test_people_outside_the_household_are_not_counted(
    client: TestClient, other_client: TestClient, third_client: TestClient
):
    share_household(client, other_client)
    create_household(third_client, "Another flat")
    add_shared(third_client, "500.00")

    assert client.get("/household/expenses").json() == []
    assert balance(client)["shared_expense_count"] == 0


# --- balance ---


def test_balance_is_even_with_no_shared_expenses(client: TestClient, other_client: TestClient):
    share_household(client, other_client)

    result = balance(client)

    assert result["currency"] == "CAD"
    assert result["shared_expense_count"] == 0
    assert result["payments"] == []
    assert nets(client) == {SAM: "0.00", ALEX: "0.00"}


def test_the_other_member_owes_half_of_what_one_paid(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00")

    assert nets(client) == {SAM: "50.00", ALEX: "-50.00"}
    assert payments(client) == [(ALEX, SAM, "50.00")]
    # Every member gets the same answer.
    assert balance(other_client) == balance(client)


def test_what_each_paid_is_set_against_the_others(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "100.00")  # Alex owes Sam 50.00
    add_shared(other_client, "160.00")  # Sam owes Alex 80.00

    assert payments(client) == [(SAM, ALEX, "30.00")]
    assert balance(client)["shared_expense_count"] == 2


def test_equal_spending_needs_no_payments(client: TestClient, other_client: TestClient):
    share_household(client, other_client)
    add_shared(client, "80.00")
    add_shared(other_client, "80.00")

    assert payments(client) == []


def test_four_people_settle_with_few_payments(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,
    fourth_client: TestClient,
):
    share_household(client, other_client, third_client, fourth_client)
    add_shared(client, "2000.00", merchant="Rent")  # each owes Sam 500
    add_shared(other_client, "120.00", merchant="Internet")  # each owes Alex 30

    # Sam: +1500 - 30. Alex: +90 - 500. Jo and Kim: -500 - 30 each.
    assert nets(client) == {SAM: "1470.00", ALEX: "-410.00", JO: "-530.00", KIM: "-530.00"}
    assert payments(client) == [
        (JO, SAM, "530.00"),
        (KIM, SAM, "530.00"),
        (ALEX, SAM, "410.00"),
    ]


def test_balance_adds_exact_cents(
    client: TestClient, other_client: TestClient, third_client: TestClient
):
    share_household(client, other_client, third_client)
    # Sam pays three totals that do not divide by three. Alex and Jo each owe
    # 3.33 + 0.11 + 2.22 = 5.66; Sam takes the leftover cents.
    add_shared(client, "10.00")
    add_shared(client, "0.33")
    add_shared(client, "6.67")

    assert nets(client) == {SAM: "11.32", ALEX: "-5.66", JO: "-5.66"}


def test_balance_ignores_private_expenses_and_other_currencies(
    client: TestClient, other_client: TestClient
):
    share_household(client, other_client)
    add_shared(client, "100.00")
    add_shared(client, "40.00", currency="USD")
    client.post("/expenses", json=expense_payload(total="999.00", subtotal=None, tax=None))

    assert payments(client) == [(ALEX, SAM, "50.00")]
    assert payments(client, currency="USD") == [(ALEX, SAM, "20.00")]


def test_balance_alone_in_a_household_is_even(client: TestClient):
    create_household(client)
    add_shared(client, "100.00")

    assert nets(client) == {SAM: "0.00"}
    assert payments(client) == []


def test_someone_who_joins_later_does_not_owe_for_older_expenses(
    client: TestClient, other_client: TestClient, third_client: TestClient
):
    household = create_household(client)
    code = {"invite_code": household["invite_code"]}
    other_client.post("/household/join", json=code)
    add_shared(client, "100.00")  # split between Sam and Alex only

    third_client.post("/household/join", json=code)

    assert nets(client) == {SAM: "50.00", ALEX: "-50.00", JO: "0.00"}
