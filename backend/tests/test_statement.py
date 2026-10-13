"""The monthly wallet statement, downloaded as a CSV file.

`client` is logged in as Sam and `other_client` as Alex.
"""

import csv
import datetime
import io

import pytest
from fastapi.testclient import TestClient

from app.statement import month_bounds, safe_cell
from tests.test_household import ALEX, SAM
from tests.test_wallet import send, top_up

THIS_MONTH = datetime.datetime.now(datetime.UTC).strftime("%Y-%m")


def statement(client: TestClient, month: str = THIS_MONTH):
    return client.get("/wallet/statement", params={"month": month})


def rows(client: TestClient, month: str = THIS_MONTH) -> list[list[str]]:
    return list(csv.reader(io.StringIO(statement(client, month).text)))


# --- the helpers ---


def test_a_month_runs_from_its_first_day_to_the_next_months():
    start, end = month_bounds("2026-12")

    assert (start.isoformat(), end.isoformat()) == (
        "2026-12-01T00:00:00+00:00",
        "2027-01-01T00:00:00+00:00",
    )


@pytest.mark.parametrize("text", ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"])
def test_text_that_looks_like_a_formula_is_made_plain(text: str):
    assert safe_cell(text) == f"'{text}"


def test_ordinary_text_is_left_alone():
    assert safe_cell("Pizza night") == "Pizza night"
    assert safe_cell(None) == ""


# --- the file ---


def test_it_is_a_csv_file_to_download(client: TestClient):
    response = statement(client)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        f'attachment; filename="splitpay-statement-{THIS_MONTH}.csv"'
    )


def test_an_empty_month_has_only_the_opening_and_closing_lines(client: TestClient):
    lines = rows(client)

    assert lines[0] == [
        "Date",
        "Description",
        "Other party",
        "Note",
        "Money in",
        "Money out",
        "Balance",
    ]
    assert [line[1] for line in lines[1:]] == ["Opening balance", "Closing balance"]
    assert [line[6] for line in lines[1:]] == ["0.00", "0.00"]


def test_each_line_carries_the_balance_after_it(client: TestClient, other_client: TestClient):
    top_up(client, "100.00")
    send(client, ALEX, "30.00", note="Pizza")
    top_up(other_client, "50.00")
    send(other_client, SAM, "5.50")

    lines = rows(client)

    assert [line[1:] for line in lines[1:]] == [
        ["Opening balance", "", "", "", "", "0.00"],
        ["Added money", "", "", "100.00", "", "100.00"],
        ["Sent", ALEX, "Pizza", "", "30.00", "70.00"],
        ["Received", ALEX, "", "5.50", "", "75.50"],
        ["Closing balance", "", "", "", "", "75.50"],
    ]
    # Alex's statement shows the same two transfers from the other side.
    assert [line[1] for line in rows(other_client)[2:-1]] == ["Received", "Added money", "Sent"]


def test_a_bill_is_listed_with_the_companys_name(client: TestClient):
    top_up(client, "100.00")
    saved = client.post(
        "/bills/saved", json={"biller_code": "maplenet", "account_number": "AB-1234"}
    ).json()
    client.post(
        "/bills/pay",
        json={
            "saved_biller_id": saved["id"],
            "amount": "40.00",
            "idempotency_key": "bill-key-0001",
        },
    )

    assert rows(client)[3][1:] == ["Bill payment", "", "MapleNet", "", "40.00", "60.00"]


def test_a_note_that_looks_like_a_formula_cannot_run(client: TestClient, other_client: TestClient):
    top_up(client, "10.00")
    send(client, ALEX, "1.00", note='=HYPERLINK("http://evil.example")')

    assert rows(other_client)[2][3] == '\'=HYPERLINK("http://evil.example")'


def test_another_month_starts_from_what_came_before(client: TestClient):
    top_up(client, "100.00")
    year, month = (int(part) for part in THIS_MONTH.split("-"))
    next_month = f"{year + 1}-01" if month == 12 else f"{year}-{month + 1:02d}"
    last_month = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"

    # Next month opens with this month's money and has no lines of its own.
    assert [line[6] for line in rows(client, next_month)[1:]] == ["100.00", "100.00"]
    assert [line[6] for line in rows(client, last_month)[1:]] == ["0.00", "0.00"]


@pytest.mark.parametrize("month", ["2026-13", "2026-00", "26-10", "2026-1", "october", ""])
def test_a_bad_month_is_refused(client: TestClient, month: str):
    assert statement(client, month).status_code == 422


def test_the_statement_requires_a_login(anonymous_client: TestClient):
    assert (
        anonymous_client.get("/wallet/statement", params={"month": THIS_MONTH}).status_code == 401
    )
