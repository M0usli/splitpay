import csv
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.test_expenses import create_receipt, expense_payload


def read_csv(text: str) -> list[dict[str, str]]:
    """Parse CSV text into one dictionary per row, keyed by the header."""
    return list(csv.DictReader(io.StringIO(text)))


def test_export_is_a_downloadable_csv_file(client: TestClient):
    response = client.get("/expenses/export.csv")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == 'attachment; filename="expenses.csv"'


def test_export_with_no_expenses_has_only_the_header(client: TestClient):
    response = client.get("/expenses/export.csv")

    assert response.text.strip() == (
        "date,merchant,category,subtotal,tax,total,currency,notes,source,edited"
    )


def test_export_contains_one_row_per_expense_newest_first(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="Old", date="2026-09-01"))
    client.post("/expenses", json=expense_payload(merchant="New", date="2026-10-20"))

    rows = read_csv(client.get("/expenses/export.csv").text)

    assert [row["merchant"] for row in rows] == ["New", "Old"]
    assert rows[0] == {
        "date": "2026-10-20",
        "merchant": "New",
        "category": "Groceries",
        "subtotal": "40.00",
        "tax": "5.20",
        "total": "45.20",
        "currency": "CAD",
        "notes": "",
        "source": "manual",
        "edited": "no",
    }


def test_export_leaves_missing_amounts_empty(client: TestClient):
    client.post("/expenses", json=expense_payload(subtotal=None, tax=None))

    row = read_csv(client.get("/expenses/export.csv").text)[0]

    assert row["subtotal"] == ""
    assert row["tax"] == ""
    assert row["total"] == "45.20"


def test_export_shows_source_and_whether_the_ai_was_corrected(
    client: TestClient, db_session: Session
):
    receipt = create_receipt(db_session)
    client.post("/expenses", json=expense_payload(receipt_id=receipt.id, total="46.00"))

    row = read_csv(client.get("/expenses/export.csv").text)[0]

    assert row["source"] == "receipt"
    assert row["edited"] == "yes"


def test_export_applies_the_month_and_category_filters(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="Sept groceries", date="2026-09-15"))
    client.post("/expenses", json=expense_payload(merchant="Oct groceries", date="2026-10-15"))
    client.post(
        "/expenses",
        json=expense_payload(merchant="Oct dining", date="2026-10-16", category="Dining"),
    )

    response = client.get(
        "/expenses/export.csv", params={"month": "2026-10", "category": "Groceries"}
    )

    assert [row["merchant"] for row in read_csv(response.text)] == ["Oct groceries"]


def test_export_rejects_a_badly_formatted_month(client: TestClient):
    response = client.get("/expenses/export.csv", params={"month": "October"})

    assert response.status_code == 422


def test_export_keeps_commas_quotes_and_line_breaks_intact(client: TestClient):
    notes = 'Bought "organic" eggs, milk\nand bread'
    client.post("/expenses", json=expense_payload(merchant="Farm Boy, Inc.", notes=notes))

    row = read_csv(client.get("/expenses/export.csv").text)[0]

    assert row["merchant"] == "Farm Boy, Inc."
    assert row["notes"] == notes


def test_export_stops_text_from_being_run_as_a_spreadsheet_formula(client: TestClient):
    client.post(
        "/expenses",
        json=expense_payload(merchant="=HYPERLINK(evil)", notes="+1 for the service"),
    )

    row = read_csv(client.get("/expenses/export.csv").text)[0]

    assert row["merchant"] == "'=HYPERLINK(evil)"
    assert row["notes"] == "'+1 for the service"
