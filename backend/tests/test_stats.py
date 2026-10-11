import datetime

import pytest
from fastapi.testclient import TestClient

from app.dates import last_months, month_range
from tests.test_expenses import expense_payload


def add(client: TestClient, merchant: str, date: str, total: str, **overrides) -> None:
    payload = expense_payload(
        merchant=merchant, date=date, total=total, subtotal=None, tax=None, **overrides
    )
    assert client.post("/expenses", json=payload).status_code == 201


def summary(client: TestClient, month: str = "2026-10", **params) -> dict:
    response = client.get("/stats/summary", params={"month": month, **params})
    assert response.status_code == 200
    return response.json()


# --- month helpers ---


def test_month_range_covers_the_whole_month():
    assert month_range("2026-02") == (datetime.date(2026, 2, 1), datetime.date(2026, 3, 1))
    assert month_range("2026-12") == (datetime.date(2026, 12, 1), datetime.date(2027, 1, 1))


def test_last_months_goes_back_across_a_year_boundary():
    assert last_months("2026-02", 3) == ["2025-12", "2026-01", "2026-02"]
    assert last_months("2026-10", 1) == ["2026-10"]


# --- empty database ---


def test_summary_with_no_expenses_is_all_zeros(client: TestClient):
    body = summary(client)

    assert body["month"] == "2026-10"
    assert body["currency"] == "CAD"
    assert body["month_total"] == "0.00"
    assert body["expense_count"] == 0
    assert body["by_category"] == []
    assert body["top_merchants"] == []
    assert body["monthly_totals"] == [
        {"month": month, "total": "0.00"}
        for month in ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    ]


# --- this month's total ---


def test_month_total_adds_up_only_the_chosen_month(client: TestClient):
    add(client, "A", "2026-09-30", "100.00")  # the day before
    add(client, "B", "2026-10-01", "10.10")
    add(client, "C", "2026-10-31", "20.20")
    add(client, "D", "2026-11-01", "100.00")  # the day after

    body = summary(client)

    assert body["month_total"] == "30.30"
    assert body["expense_count"] == 2


def test_totals_are_exact_decimals(client: TestClient):
    # With floats, 0.10 + 0.20 would be 0.30000000000000004.
    add(client, "A", "2026-10-01", "0.10")
    add(client, "B", "2026-10-02", "0.20")

    assert summary(client)["month_total"] == "0.30"


# --- by category ---


def test_by_category_is_sorted_largest_first(client: TestClient):
    add(client, "Loblaws", "2026-10-01", "40.00", category="Groceries")
    add(client, "FreshCo", "2026-10-02", "25.50", category="Groceries")
    add(client, "Tim Hortons", "2026-10-03", "7.35", category="Dining")
    add(client, "Rogers", "2026-10-04", "90.00", category="Bills & Utilities")
    add(client, "Last month", "2026-09-04", "500.00", category="Shopping")

    assert summary(client)["by_category"] == [
        {"category": "Bills & Utilities", "total": "90.00"},
        {"category": "Groceries", "total": "65.50"},
        {"category": "Dining", "total": "7.35"},
    ]


# --- last six months ---


def test_monthly_totals_cover_six_months_and_fill_gaps_with_zero(client: TestClient):
    add(client, "Too old", "2026-04-30", "999.00")  # seven months back: not included
    add(client, "May", "2026-05-01", "50.00")
    add(client, "August a", "2026-08-10", "30.00")
    add(client, "August b", "2026-08-20", "12.50")
    add(client, "October", "2026-10-15", "20.00")

    assert summary(client)["monthly_totals"] == [
        {"month": "2026-05", "total": "50.00"},
        {"month": "2026-06", "total": "0.00"},
        {"month": "2026-07", "total": "0.00"},
        {"month": "2026-08", "total": "42.50"},
        {"month": "2026-09", "total": "0.00"},
        {"month": "2026-10", "total": "20.00"},
    ]


def test_monthly_totals_work_across_a_year_boundary(client: TestClient):
    add(client, "December", "2025-12-25", "80.00")
    add(client, "January", "2026-01-05", "15.00")

    months = summary(client, month="2026-02")["monthly_totals"]

    assert [entry["month"] for entry in months] == [
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    ]
    assert months[3]["total"] == "80.00"
    assert months[4]["total"] == "15.00"


# --- top merchants ---


def test_top_merchants_are_the_five_biggest_over_six_months(client: TestClient):
    for merchant, total in [("A", "10"), ("B", "60"), ("C", "30"), ("D", "20"), ("E", "50")]:
        add(client, merchant, "2026-10-05", total)
    add(client, "F", "2026-07-05", "40")  # an earlier month, still inside the six
    add(client, "Too old", "2026-04-05", "999")

    merchants = summary(client)["top_merchants"]

    assert [entry["merchant"] for entry in merchants] == ["B", "E", "F", "C", "D"]
    assert merchants[0] == {"merchant": "B", "total": "60.00", "expense_count": 1}


def test_top_merchants_combine_visits_and_ignore_letter_case(client: TestClient):
    add(client, "FreshCo", "2026-10-01", "20.00")
    add(client, "FRESHCO", "2026-10-08", "30.00")
    add(client, " freshco ", "2026-09-08", "5.00")
    add(client, "Loblaws", "2026-10-02", "40.00")

    merchants = summary(client)["top_merchants"]

    assert [(m["merchant"].strip().lower(), m["total"], m["expense_count"]) for m in merchants] == [
        ("freshco", "55.00", 3),
        ("loblaws", "40.00", 1),
    ]


# --- currency ---


def test_other_currencies_are_not_mixed_in(client: TestClient):
    add(client, "Loblaws", "2026-10-01", "40.00")
    add(client, "Target", "2026-10-02", "25.00", currency="USD")

    cad = summary(client)
    usd = summary(client, currency="USD")

    assert cad["month_total"] == "40.00"
    assert [m["merchant"] for m in cad["top_merchants"]] == ["Loblaws"]
    assert usd["month_total"] == "25.00"
    assert usd["currency"] == "USD"


# --- parameters ---


def test_month_defaults_to_the_current_month(client: TestClient):
    response = client.get("/stats/summary")

    assert response.status_code == 200
    assert response.json()["month"] == datetime.date.today().strftime("%Y-%m")


@pytest.mark.parametrize(
    "params", [{"month": "October"}, {"month": "2026-13"}, {"currency": "cad"}]
)
def test_bad_parameters_are_rejected(client: TestClient, params: dict):
    response = client.get("/stats/summary", params=params)

    assert response.status_code == 422
