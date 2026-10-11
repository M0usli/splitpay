"""Recurring monthly costs: the templates and the expenses made from them.

`client` is logged in as Sam and `other_client` as Alex. "Today" is chosen by
each test through the `set_today` fixture.
"""

import datetime
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.main import app
from app.models import Expense
from app.recurring import due_dates, next_occurrence
from app.routers.recurring import get_today
from tests.test_household import ALEX, SAM, payments, share_household

date = datetime.date


@pytest.fixture
def set_today(client: TestClient) -> Callable[[str], None]:
    """Returns a function that sets the server's "today" for later requests."""

    def set_to(day: str) -> None:
        app.dependency_overrides[get_today] = lambda: date.fromisoformat(day)

    # The `client` fixture clears every override when the test ends.
    set_to("2026-10-11")
    return set_to


def rent(**overrides) -> dict:
    """A valid request body: rent of 1500.00 on the 1st, starting 1 October 2026."""
    payload = {
        "merchant": "Rent",
        "total": "1500.00",
        "category": "Bills & Utilities",
        "day_of_month": 1,
        "start_date": "2026-10-01",
    }
    payload.update(overrides)
    return payload


def run(client: TestClient) -> list[dict]:
    response = client.post("/recurring/run")
    assert response.status_code == 200
    return response.json()


# --- when a cost is due (plain functions, no database) ---


def test_one_date_per_month_from_the_start_up_to_today():
    dates = due_dates(
        15, start_date=date(2026, 8, 1), today=date(2026, 10, 20), months_already_made=set()
    )

    assert dates == [date(2026, 8, 15), date(2026, 9, 15), date(2026, 10, 15)]


def test_this_months_date_is_not_due_before_its_day():
    dates = due_dates(
        15, start_date=date(2026, 8, 1), today=date(2026, 10, 14), months_already_made=set()
    )

    assert dates == [date(2026, 8, 15), date(2026, 9, 15)]


def test_a_date_before_the_start_is_not_due():
    # Started on the 20th: the 15th of that month has already passed.
    dates = due_dates(
        15, start_date=date(2026, 8, 20), today=date(2026, 10, 20), months_already_made=set()
    )

    assert dates == [date(2026, 9, 15), date(2026, 10, 15)]


def test_months_that_already_have_their_expense_are_left_out():
    dates = due_dates(
        15,
        start_date=date(2026, 8, 1),
        today=date(2026, 10, 20),
        months_already_made={"2026-08", "2026-10"},
    )

    assert dates == [date(2026, 9, 15)]


def test_due_dates_cross_a_year_boundary():
    dates = due_dates(
        28, start_date=date(2026, 11, 1), today=date(2027, 2, 28), months_already_made=set()
    )

    assert dates == [date(2026, 11, 28), date(2026, 12, 28), date(2027, 1, 28), date(2027, 2, 28)]


def test_nothing_is_due_before_the_start_date():
    assert (
        due_dates(
            1, start_date=date(2026, 12, 1), today=date(2026, 10, 11), months_already_made=set()
        )
        == []
    )


def test_a_long_absence_catches_up_on_the_last_twelve_months_only():
    dates = due_dates(
        1, start_date=date(2020, 1, 1), today=date(2026, 10, 11), months_already_made=set()
    )

    assert len(dates) == 12
    assert dates[0] == date(2025, 11, 1)
    assert dates[-1] == date(2026, 10, 1)


@pytest.mark.parametrize(
    ("day", "start", "today", "expected"),
    [
        (15, "2026-10-01", "2026-10-11", "2026-10-15"),  # later this month
        (15, "2026-10-01", "2026-10-15", "2026-11-15"),  # today's one is already due
        (1, "2026-10-01", "2026-12-20", "2027-01-01"),  # into next year
        (1, "2027-03-10", "2026-10-11", "2027-04-01"),  # not before the start date
    ],
)
def test_next_occurrence(day: int, start: str, today: str, expected: str):
    result = next_occurrence(day, date.fromisoformat(start), date.fromisoformat(today))

    assert result == date.fromisoformat(expected)


# --- creating, listing, changing, stopping ---


def test_create_a_recurring_cost(client: TestClient, set_today):
    response = client.post("/recurring", json=rent())

    assert response.status_code == 201
    body = response.json()
    assert body["merchant"] == "Rent"
    assert body["total"] == "1500.00"
    assert body["is_active"] is True
    assert body["next_date"] == "2026-11-01"
    assert client.get("/recurring").json() == [body]


def test_the_start_date_defaults_to_today(client: TestClient, set_today):
    body = client.post("/recurring", json=rent(start_date=None, day_of_month=20)).json()

    assert body["start_date"] == "2026-10-11"
    assert body["next_date"] == "2026-10-20"


@pytest.mark.parametrize(
    "bad",
    [
        {"day_of_month": 0},
        {"day_of_month": 29},  # does not exist in every February
        {"total": "-5.00"},
        {"merchant": ""},
        {"category": "Gambling"},
    ],
)
def test_bad_values_are_rejected(client: TestClient, set_today, bad: dict):
    assert client.post("/recurring", json=rent(**bad)).status_code == 422


def test_change_a_recurring_cost(client: TestClient, set_today):
    created = client.post("/recurring", json=rent()).json()

    response = client.put(f"/recurring/{created['id']}", json=rent(total="1550.00", day_of_month=3))

    assert response.status_code == 200
    assert response.json()["total"] == "1550.00"
    assert response.json()["next_date"] == "2026-11-03"


def test_recurring_costs_belong_to_their_owner(
    client: TestClient, other_client: TestClient, anonymous_client: TestClient, set_today
):
    created = client.post("/recurring", json=rent()).json()
    url = f"/recurring/{created['id']}"

    assert other_client.get("/recurring").json() == []
    assert other_client.put(url, json=rent(total="1.00")).status_code == 404
    assert other_client.delete(url).status_code == 404
    assert run(other_client) == []
    anonymous_client.cookies.clear()
    assert anonymous_client.get("/recurring").status_code == 401
    assert anonymous_client.post("/recurring/run").status_code == 401


# --- making the monthly expenses ---


def test_run_makes_the_expense_that_is_due(client: TestClient, set_today):
    recurring = client.post("/recurring", json=rent()).json()

    created = run(client)

    assert len(created) == 1
    expense = created[0]
    assert expense["merchant"] == "Rent"
    assert expense["date"] == "2026-10-01"
    assert expense["total"] == "1500.00"
    assert expense["recurring_id"] == recurring["id"]
    assert len(client.get("/expenses").json()) == 1


def test_running_twice_makes_no_duplicates(client: TestClient, set_today):
    client.post("/recurring", json=rent())

    assert len(run(client)) == 1
    assert run(client) == []
    assert run(client) == []

    assert len(client.get("/expenses").json()) == 1


def test_nothing_is_made_before_the_day_arrives(client: TestClient, set_today):
    client.post("/recurring", json=rent(day_of_month=20))

    assert run(client) == []

    set_today("2026-10-20")
    assert [expense["date"] for expense in run(client)] == ["2026-10-20"]


def test_each_new_month_gets_one_expense(client: TestClient, set_today):
    client.post("/recurring", json=rent())
    run(client)

    set_today("2026-11-01")
    assert [expense["date"] for expense in run(client)] == ["2026-11-01"]
    set_today("2026-11-30")
    assert run(client) == []
    set_today("2026-12-01")
    assert [expense["date"] for expense in run(client)] == ["2026-12-01"]


def test_missed_months_are_caught_up_in_order(client: TestClient, set_today):
    client.post("/recurring", json=rent())

    # The app was not opened from October to January.
    set_today("2027-01-05")
    created = run(client)

    assert [expense["date"] for expense in created] == [
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
    ]


def test_a_stopped_cost_makes_no_more_expenses_but_keeps_the_old_ones(
    client: TestClient, set_today
):
    recurring = client.post("/recurring", json=rent()).json()
    run(client)

    stopped = client.put(f"/recurring/{recurring['id']}", json=rent(is_active=False)).json()
    set_today("2026-11-01")

    assert stopped["is_active"] is False
    assert stopped["next_date"] is None
    assert run(client) == []
    assert len(client.get("/expenses").json()) == 1


def test_deleting_a_cost_keeps_the_expenses_it_made(client: TestClient, set_today):
    recurring = client.post("/recurring", json=rent()).json()
    run(client)

    assert client.delete(f"/recurring/{recurring['id']}").status_code == 204

    assert client.get("/recurring").json() == []
    expenses = client.get("/expenses").json()
    assert len(expenses) == 1
    assert expenses[0]["recurring_id"] is None


def test_an_expense_deleted_by_hand_is_made_again_only_once(client: TestClient, set_today):
    """Deleting October's rent means there is no October expense, so the next
    run makes it again. That is the rule: one expense per month, if due."""
    client.post("/recurring", json=rent())
    expense = run(client)[0]

    client.delete(f"/expenses/{expense['id']}")

    assert len(run(client)) == 1
    assert run(client) == []


def test_the_database_refuses_a_second_expense_for_the_same_month(
    client: TestClient, set_today, db_session: Session
):
    recurring = client.post("/recurring", json=rent()).json()
    first = run(client)[0]
    owner = db_session.get(Expense, first["id"]).user_id

    # What a second request arriving at the same moment would try to insert.
    duplicate = Expense(
        user_id=owner,
        merchant="Rent",
        date=date(2026, 10, 1),
        total="1500.00",
        category="Bills & Utilities",
        recurring_id=recurring["id"],
        recurring_month="2026-10",
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


# --- sharing ---


def test_a_shared_cost_is_split_equally_each_month(
    client: TestClient, other_client: TestClient, set_today
):
    members = share_household(client, other_client)
    client.post("/recurring", json=rent(is_shared=True))

    expense = run(client)[0]

    assert expense["is_shared"] is True
    assert expense["shares"] == [
        {"user_id": members[SAM], "amount": "750.00"},
        {"user_id": members[ALEX], "amount": "750.00"},
    ]
    assert payments(client) == [(ALEX, SAM, "750.00")]


def test_a_shared_cost_can_have_fixed_parts(
    client: TestClient, other_client: TestClient, set_today
):
    members = share_household(client, other_client)
    # Sam has the bigger room.
    parts = [
        {"user_id": members[SAM], "amount": "900.00"},
        {"user_id": members[ALEX], "amount": "600.00"},
    ]
    recurring = client.post("/recurring", json=rent(is_shared=True, shares=parts)).json()

    expense = run(client)[0]

    assert recurring["shares"] == parts
    assert expense["shares"] == parts


def test_parts_must_add_up_and_go_to_household_members(
    client: TestClient, other_client: TestClient, set_today
):
    members = share_household(client, other_client)
    short = [{"user_id": members[ALEX], "amount": "600.00"}]
    stranger = [{"user_id": 999, "amount": "1500.00"}]

    assert client.post("/recurring", json=rent(is_shared=True, shares=short)).status_code == 422
    assert client.post("/recurring", json=rent(is_shared=True, shares=stranger)).status_code == 422
    assert client.get("/recurring").json() == []


def test_sharing_needs_a_household(client: TestClient, set_today):
    assert client.post("/recurring", json=rent(is_shared=True)).status_code == 409


def test_a_cost_whose_sharing_no_longer_fits_is_still_recorded(
    client: TestClient, other_client: TestClient, set_today
):
    share_household(client, other_client)
    client.post("/recurring", json=rent(is_shared=True))
    # Sam leaves the household, so there is nobody to share with any more.
    client.post("/household/leave")

    expense = run(client)[0]

    assert expense["total"] == "1500.00"
    assert expense["is_shared"] is False
    assert expense["shares"] == []
