"""Splitting a receipt item by item among household members.

In the API tests `client` is logged in as Sam (the payer) and `other_client`
as Alex. The plain-function tests use person 1 as the payer.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.splitting import ItemLine, split_by_items, split_in_proportion
from tests.test_expenses import expense_payload
from tests.test_household import (
    ALEX,
    JO,
    KIM,
    SAM,
    fourth_client,  # noqa: F401  (fixtures defined in test_household.py)
    payments,
    share_household,
    third_client,  # noqa: F401
)

ME = 1


def line(price: str, shared_by: list[int], taxed: bool = False) -> ItemLine:
    return ItemLine(price=Decimal(price), is_taxable=taxed, shared_by=shared_by)


def amounts(lines: list[ItemLine], tax: str, total: str) -> dict[int, Decimal]:
    people = split_by_items(lines, Decimal(tax), Decimal(total), payer_id=ME)
    return {person: split.amount for person, split in people.items()}


# The made-up FreshCo receipt: subtotal 36.85, tax 1.62 (13% of the two taxed
# lines, 12.48), total 38.47.
FRESHCO = [
    line("6.49", [1]),  # milk, mine
    line("3.29", [2]),  # bread, my roommate's
    line("1.75", [1, 2]),  # bananas, shared
    line("12.84", [1]),  # chicken, mine
    line("8.99", [1, 2], taxed=True),  # paper towels, shared
    line("3.49", [2], taxed=True),  # dish soap, my roommate's
]


# --- split_in_proportion ---


@pytest.mark.parametrize(
    ("amount", "weights", "parts"),
    [
        ("1.62", ["4.50", "7.98"], ["0.58", "1.04"]),
        ("10.00", ["1", "1", "1"], ["3.34", "3.33", "3.33"]),
        ("0.01", ["1", "99"], ["0.00", "0.01"]),
        ("5.00", ["0", "3"], ["0.00", "5.00"]),
        # Nothing to go by: split equally.
        ("1.00", ["0", "0"], ["0.50", "0.50"]),
        # Money to take off is split the same way.
        ("-0.03", ["1", "1"], ["-0.02", "-0.01"]),
        ("0.00", ["2", "5"], ["0.00", "0.00"]),
    ],
)
def test_split_in_proportion_adds_up_exactly(amount: str, weights: list[str], parts: list[str]):
    result = split_in_proportion(Decimal(amount), [Decimal(weight) for weight in weights])

    assert result == [Decimal(part) for part in parts]
    assert sum(result) == Decimal(amount)


# --- split_by_items ---


def test_each_person_pays_for_their_items_and_their_part_of_the_tax():
    people = split_by_items(FRESHCO, Decimal("1.62"), Decimal("38.47"), payer_id=ME)

    # Me: milk 6.49 + half the bananas 0.88 + chicken 12.84 + half the towels 4.50.
    assert people[1].items == Decimal("24.71")
    # Roommate: bread 3.29 + bananas 0.87 + towels 4.49 + soap 3.49.
    assert people[2].items == Decimal("12.14")
    # Tax follows the taxed lines only: 4.50 for me, 7.98 for my roommate.
    assert people[1].tax == Decimal("0.58")
    assert people[2].tax == Decimal("1.04")
    assert people[1].amount + people[2].amount == Decimal("38.47")


def test_someone_who_bought_only_untaxed_items_pays_no_tax():
    lines = [line("5.00", [1]), line("10.00", [2], taxed=True)]

    people = split_by_items(lines, Decimal("1.30"), Decimal("16.30"), payer_id=ME)

    assert people[1].tax == Decimal("0.00")
    assert people[2].tax == Decimal("1.30")


def test_tax_follows_all_items_when_none_is_marked_as_taxed():
    # A restaurant bill: nothing is marked, everything was taxed.
    lines = [line("30.00", [1]), line("10.00", [2])]

    assert amounts(lines, tax="5.20", total="45.20") == {1: Decimal("33.90"), 2: Decimal("11.30")}


def test_an_item_can_be_shared_by_only_some_of_four_people():
    lines = [
        line("24.00", [2, 4]),  # a pizza only two people ate
        line("12.00", [1, 2, 3, 4]),  # drinks for everyone
        line("7.00", [3]),
    ]

    assert amounts(lines, tax="0", total="43.00") == {
        1: Decimal("3.00"),
        2: Decimal("15.00"),
        3: Decimal("10.00"),
        4: Decimal("15.00"),
    }


def test_the_same_item_twice_can_go_one_to_each_person():
    # "2 x YOGURT 7.98": tick both people, and each pays for one.
    assert amounts([line("7.98", [1, 2])], tax="0", total="7.98") == {
        1: Decimal("3.99"),
        2: Decimal("3.99"),
    }


def test_the_payer_takes_the_cent_an_item_cannot_divide():
    # Person 2 comes first in the list, but person 1 paid.
    assert amounts([line("0.99", [2, 1])], tax="0", total="0.99") == {
        1: Decimal("0.50"),
        2: Decimal("0.49"),
    }


def test_money_no_item_accounts_for_is_spread_in_proportion():
    # A 0.40 bag fee is on the receipt but is not one of the lines.
    lines = [line("30.00", [1]), line("10.00", [2])]

    people = split_by_items(lines, Decimal("0"), Decimal("40.40"), payer_id=ME)

    assert people[1].adjustment == Decimal("0.30")
    assert people[2].adjustment == Decimal("0.10")
    assert people[1].amount + people[2].amount == Decimal("40.40")


def test_a_total_below_the_items_takes_money_off_in_proportion():
    lines = [line("30.00", [1]), line("10.00", [2])]

    assert amounts(lines, tax="0", total="36.00") == {1: Decimal("27.00"), 2: Decimal("9.00")}


def test_a_discount_reduces_what_the_people_sharing_it_pay():
    lines = [line("20.00", [1, 2]), line("-4.00", [1, 2]), line("5.00", [2])]

    assert amounts(lines, tax="0", total="21.00") == {1: Decimal("8.00"), 2: Decimal("13.00")}


def test_a_discount_given_to_someone_with_nothing_else_is_refused():
    lines = [line("20.00", [1]), line("-4.00", [2])]

    with pytest.raises(ValueError, match="less than nothing"):
        split_by_items(lines, Decimal("0"), Decimal("16.00"), payer_id=ME)


def test_no_items_is_refused():
    with pytest.raises(ValueError):
        split_by_items([], Decimal("0"), Decimal("10.00"), payer_id=ME)


@pytest.mark.parametrize("people_count", [2, 3, 4, 7])
@pytest.mark.parametrize("tax", ["0", "0.01", "1.37", "13.00"])
def test_the_parts_always_add_up_to_the_total(people_count: int, tax: str):
    # Awkward prices, each shared by a different group of people.
    everyone = list(range(1, people_count + 1))
    prices = ["0.01", "0.99", "3.33", "7.77", "10.00", "19.99", "100.01"]
    lines = [
        line(price, everyone[: 1 + position % people_count], taxed=position % 2 == 0)
        for position, price in enumerate(prices)
    ]
    total = sum(Decimal(price) for price in prices) + Decimal(tax) + Decimal("0.07")

    people = split_by_items(lines, Decimal(tax), total, payer_id=ME)

    assert sum(split.amount for split in people.values()) == total
    assert all(split.amount >= 0 for split in people.values())


# --- saving an expense split by items ---


def split_payload(members: dict[str, int], **overrides) -> dict:
    """The FreshCo receipt with Sam as person 1 and Alex as person 2."""
    sam, alex = members[SAM], members[ALEX]
    items = [
        {"name": "2% MILK 4L", "price": "6.49", "is_taxable": False, "shared_by": [sam]},
        {"name": "WW BREAD", "price": "3.29", "is_taxable": False, "shared_by": [alex]},
        {"name": "BANANAS", "price": "1.75", "is_taxable": False, "shared_by": [sam, alex]},
        {"name": "CHICKEN", "price": "12.84", "is_taxable": False, "shared_by": [sam]},
        {"name": "PAPER TOWELS", "price": "8.99", "is_taxable": True, "shared_by": [sam, alex]},
        {"name": "DISH SOAP", "price": "3.49", "is_taxable": True, "shared_by": [alex]},
    ]
    payload = expense_payload(subtotal="36.85", tax="1.62", total="38.47", is_shared=True)
    payload["split_items"] = items
    payload.update(overrides)
    return payload


def test_the_server_works_out_the_shares_from_the_items(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)

    response = client.post("/expenses", json=split_payload(members))

    assert response.status_code == 201
    expense = response.json()
    assert expense["shares"] == [
        {"user_id": members[SAM], "amount": "25.29"},
        {"user_id": members[ALEX], "amount": "13.18"},
    ]
    assert payments(client) == [(ALEX, SAM, "13.18")]


def test_the_item_choices_are_saved_so_the_split_can_be_reopened(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)
    payload = split_payload(members)
    created = client.post("/expenses", json=payload).json()

    reopened = client.get(f"/expenses/{created['id']}").json()

    assert reopened["split_items"] == payload["split_items"]


def test_shares_sent_alongside_items_are_ignored(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    # Someone tries to send their own, more favourable parts.
    cheat = [{"user_id": members[ALEX], "amount": "38.47"}]

    expense = client.post("/expenses", json=split_payload(members, shares=cheat)).json()

    assert [share["amount"] for share in expense["shares"]] == ["25.29", "13.18"]


def test_changing_who_an_item_is_for_changes_the_shares(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)
    payload = split_payload(members)
    expense = client.post("/expenses", json=payload).json()

    # The chicken was Alex's after all.
    payload["split_items"][3]["shared_by"] = [members[ALEX]]
    updated = client.put(f"/expenses/{expense['id']}", json=payload).json()

    assert [share["amount"] for share in updated["shares"]] == ["12.45", "26.02"]
    assert updated["split_items"][3]["shared_by"] == [members[ALEX]]


def test_unsharing_forgets_the_item_choices(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    expense = client.post("/expenses", json=split_payload(members)).json()

    updated = client.put(
        f"/expenses/{expense['id']}", json=split_payload(members, is_shared=False)
    ).json()

    assert updated["shares"] == []
    assert updated["split_items"] is None


def test_an_item_cannot_go_to_someone_outside_the_household(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
):
    members = share_household(client, other_client)
    payload = split_payload(members)
    payload["split_items"][0]["shared_by"] = [third_client.get("/auth/me").json()["id"]]

    response = client.post("/expenses", json=payload)

    assert response.status_code == 422
    assert client.get("/expenses").json() == []


def test_every_item_needs_at_least_one_person(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    payload = split_payload(members)
    payload["split_items"][0]["shared_by"] = []

    assert client.post("/expenses", json=payload).status_code == 422


def test_an_impossible_discount_is_explained(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    payload = expense_payload(subtotal=None, tax=None, total="16.00", is_shared=True)
    payload["split_items"] = [
        {"name": "ITEM", "price": "20.00", "is_taxable": False, "shared_by": [members[SAM]]},
        {"name": "COUPON", "price": "-4.00", "is_taxable": False, "shared_by": [members[ALEX]]},
    ]

    response = client.post("/expenses", json=payload)

    assert response.status_code == 422
    assert "less than nothing" in response.json()["detail"]


def test_four_people_split_a_receipt(
    client: TestClient,
    other_client: TestClient,
    third_client: TestClient,  # noqa: F811
    fourth_client: TestClient,  # noqa: F811
):
    members = share_household(client, other_client, third_client, fourth_client)
    everyone = [members[email] for email in (SAM, ALEX, JO, KIM)]
    payload = expense_payload(subtotal="43.00", tax=None, total="43.00", is_shared=True)
    payload["split_items"] = [
        {"name": "PIZZA", "price": "24.00", "shared_by": [members[ALEX], members[KIM]]},
        {"name": "DRINKS", "price": "12.00", "shared_by": everyone},
        {"name": "SNACK", "price": "7.00", "shared_by": [members[JO]]},
    ]

    expense = client.post("/expenses", json=payload).json()

    assert {share["user_id"]: share["amount"] for share in expense["shares"]} == {
        members[SAM]: "3.00",
        members[ALEX]: "15.00",
        members[JO]: "10.00",
        members[KIM]: "15.00",
    }


# --- the preview ---


def preview(client: TestClient, payload: dict):
    body = {key: payload[key] for key in ("split_items", "tax", "total")}
    return client.post("/household/split-preview", json=body)


def test_the_preview_shows_what_each_person_pays_and_why(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)

    response = preview(client, split_payload(members))

    assert response.status_code == 200
    body = response.json()
    assert body["difference"] == "0.00"
    assert body["people"] == [
        {
            "member": {"id": members[SAM], "email": SAM},
            "items": "24.71",
            "tax": "0.58",
            "adjustment": "0.00",
            "amount": "25.29",
        },
        {
            "member": {"id": members[ALEX], "email": ALEX},
            "items": "12.14",
            "tax": "1.04",
            "adjustment": "0.00",
            "amount": "13.18",
        },
    ]


def test_the_preview_matches_what_saving_stores(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)
    payload = split_payload(members)

    shown = {
        person["member"]["id"]: person["amount"]
        for person in preview(client, payload).json()["people"]
    }
    saved = client.post("/expenses", json=payload).json()

    assert shown == {share["user_id"]: share["amount"] for share in saved["shares"]}


def test_the_preview_saves_nothing(client: TestClient, other_client: TestClient):
    members = share_household(client, other_client)

    preview(client, split_payload(members))

    assert client.get("/expenses").json() == []


def test_the_preview_reports_money_no_item_accounts_for(
    client: TestClient, other_client: TestClient
):
    members = share_household(client, other_client)

    body = preview(client, split_payload(members, total="38.87")).json()

    assert body["difference"] == "0.40"
    assert sum(Decimal(person["amount"]) for person in body["people"]) == Decimal("38.87")


def test_the_preview_needs_a_login_and_a_household(
    client: TestClient, anonymous_client: TestClient
):
    payload = {
        "split_items": [{"name": "X", "price": "1.00", "shared_by": [1]}],
        "total": "1.00",
    }

    assert client.post("/household/split-preview", json=payload).status_code == 404
    anonymous_client.cookies.clear()
    assert anonymous_client.post("/household/split-preview", json=payload).status_code == 401
