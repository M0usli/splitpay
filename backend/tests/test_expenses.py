from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Receipt


def expense_payload(**overrides) -> dict:
    """A valid request body. Pass keyword arguments to change fields."""
    payload = {
        "merchant": "Loblaws",
        "date": "2026-10-05",
        "subtotal": "40.00",
        "tax": "5.20",
        "total": "45.20",
        "currency": "CAD",
        "category": "Groceries",
        "notes": None,
    }
    payload.update(overrides)
    return payload


def create_receipt(db_session: Session) -> Receipt:
    """A receipt whose AI-extracted fields match expense_payload()."""
    receipt = Receipt(
        file_path="test.jpg",
        extracted_fields={
            "merchant": "Loblaws",
            "date": "2026-10-05",
            "subtotal": "40.00",
            "tax": "5.20",
            "total": "45.20",
            "currency": None,  # not printed on the receipt
            "category": "Groceries",
        },
    )
    db_session.add(receipt)
    db_session.commit()
    return receipt


# --- create ---


def test_create_expense(client: TestClient):
    response = client.post("/expenses", json=expense_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["merchant"] == "Loblaws"
    assert body["date"] == "2026-10-05"
    assert body["category"] == "Groceries"
    assert body["receipt_id"] is None
    assert body["was_edited"] is False


def test_money_is_returned_as_exact_decimal_strings(client: TestClient):
    response = client.post("/expenses", json=expense_payload(total="45.2"))

    assert response.json()["total"] == "45.20"
    assert response.json()["tax"] == "5.20"


def test_create_expense_applies_defaults(client: TestClient):
    response = client.post(
        "/expenses",
        json={"merchant": "TTC", "date": "2026-10-01", "total": "3.35", "category": "Transport"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["currency"] == "CAD"
    assert body["subtotal"] is None
    assert body["tax"] is None


def test_create_expense_rejects_negative_total(client: TestClient):
    response = client.post("/expenses", json=expense_payload(total="-1.00"))

    assert response.status_code == 422


def test_create_expense_rejects_unknown_category(client: TestClient):
    response = client.post("/expenses", json=expense_payload(category="Gambling"))

    assert response.status_code == 422


def test_create_expense_rejects_empty_merchant(client: TestClient):
    response = client.post("/expenses", json=expense_payload(merchant=""))

    assert response.status_code == 422


def test_create_expense_with_unknown_receipt_returns_404(client: TestClient):
    response = client.post("/expenses", json=expense_payload(receipt_id=999))

    assert response.status_code == 404
    assert response.json()["detail"] == "Receipt not found"


# --- was_edited (did the user correct the AI?) ---


def test_saving_the_extracted_values_unchanged_is_not_an_edit(
    client: TestClient, db_session: Session
):
    receipt = create_receipt(db_session)

    response = client.post("/expenses", json=expense_payload(receipt_id=receipt.id))

    body = response.json()
    assert body["receipt_id"] == receipt.id
    # The receipt had no currency, so saving the default CAD is not a correction.
    assert body["was_edited"] is False


def test_saving_a_corrected_value_is_an_edit(client: TestClient, db_session: Session):
    receipt = create_receipt(db_session)

    response = client.post(
        "/expenses", json=expense_payload(receipt_id=receipt.id, merchant="Loblaws Superstore")
    )

    assert response.json()["was_edited"] is True


def test_filling_in_a_field_the_ai_could_not_find_is_an_edit(
    client: TestClient, db_session: Session
):
    receipt = create_receipt(db_session)
    receipt.extracted_fields = {**receipt.extracted_fields, "date": None}
    db_session.commit()

    response = client.post("/expenses", json=expense_payload(receipt_id=receipt.id))

    assert response.json()["was_edited"] is True


def test_adding_notes_is_not_an_edit(client: TestClient, db_session: Session):
    receipt = create_receipt(db_session)

    response = client.post(
        "/expenses", json=expense_payload(receipt_id=receipt.id, notes="Weekly shop")
    )

    assert response.json()["was_edited"] is False


def test_client_cannot_set_was_edited_itself(client: TestClient):
    response = client.post("/expenses", json=expense_payload(was_edited=True))

    assert response.status_code == 201
    assert response.json()["was_edited"] is False


# --- list ---


def test_list_expenses_is_sorted_newest_first(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="Old", date="2026-09-01"))
    client.post("/expenses", json=expense_payload(merchant="New", date="2026-10-20"))
    client.post("/expenses", json=expense_payload(merchant="Middle", date="2026-10-02"))

    response = client.get("/expenses")

    assert response.status_code == 200
    assert [expense["merchant"] for expense in response.json()] == ["New", "Middle", "Old"]


def test_list_expenses_filters_by_month(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="September", date="2026-09-30"))
    client.post("/expenses", json=expense_payload(merchant="October", date="2026-10-01"))
    client.post("/expenses", json=expense_payload(merchant="November", date="2026-11-01"))

    response = client.get("/expenses", params={"month": "2026-10"})

    assert [expense["merchant"] for expense in response.json()] == ["October"]


def test_list_expenses_filters_by_december(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="December", date="2026-12-31"))
    client.post("/expenses", json=expense_payload(merchant="January", date="2027-01-01"))

    response = client.get("/expenses", params={"month": "2026-12"})

    assert [expense["merchant"] for expense in response.json()] == ["December"]


def test_list_expenses_filters_by_category(client: TestClient):
    client.post("/expenses", json=expense_payload(merchant="Loblaws", category="Groceries"))
    client.post(
        "/expenses", json=expense_payload(merchant="Hydro One", category="Bills & Utilities")
    )

    response = client.get("/expenses", params={"category": "Bills & Utilities"})

    assert [expense["merchant"] for expense in response.json()] == ["Hydro One"]


def test_list_expenses_rejects_badly_formatted_month(client: TestClient):
    response = client.get("/expenses", params={"month": "October"})

    assert response.status_code == 422


# --- get one ---


def test_get_expense(client: TestClient):
    created = client.post("/expenses", json=expense_payload()).json()

    response = client.get(f"/expenses/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_expense_returns_404(client: TestClient):
    response = client.get("/expenses/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Expense not found"


# --- update ---


def test_update_expense(client: TestClient):
    created = client.post("/expenses", json=expense_payload()).json()

    response = client.put(
        f"/expenses/{created['id']}",
        json=expense_payload(merchant="No Frills", total="50.00", notes="Weekly shop"),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["merchant"] == "No Frills"
    assert body["total"] == "50.00"
    assert body["notes"] == "Weekly shop"
    # A manual expense has no AI-extracted fields, so it is never "edited".
    assert body["was_edited"] is False


def test_update_marks_receipt_expense_as_edited(client: TestClient, db_session: Session):
    receipt = create_receipt(db_session)
    created = client.post("/expenses", json=expense_payload(receipt_id=receipt.id)).json()
    assert created["was_edited"] is False

    response = client.put(f"/expenses/{created['id']}", json=expense_payload(total="46.00"))

    assert response.json()["was_edited"] is True


def test_update_back_to_the_extracted_values_clears_was_edited(
    client: TestClient, db_session: Session
):
    receipt = create_receipt(db_session)
    created = client.post(
        "/expenses", json=expense_payload(receipt_id=receipt.id, total="46.00")
    ).json()
    assert created["was_edited"] is True

    response = client.put(f"/expenses/{created['id']}", json=expense_payload())

    assert response.json()["was_edited"] is False


def test_update_notes_only_does_not_mark_receipt_expense_as_edited(
    client: TestClient, db_session: Session
):
    receipt = create_receipt(db_session)
    created = client.post("/expenses", json=expense_payload(receipt_id=receipt.id)).json()

    response = client.put(f"/expenses/{created['id']}", json=expense_payload(notes="Lunch"))

    assert response.json()["was_edited"] is False


def test_update_missing_expense_returns_404(client: TestClient):
    response = client.put("/expenses/999", json=expense_payload())

    assert response.status_code == 404


# --- delete ---


def test_delete_expense(client: TestClient):
    created = client.post("/expenses", json=expense_payload()).json()

    response = client.delete(f"/expenses/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/expenses/{created['id']}").status_code == 404


def test_delete_missing_expense_returns_404(client: TestClient):
    response = client.delete("/expenses/999")

    assert response.status_code == 404
