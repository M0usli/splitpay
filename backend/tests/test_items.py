"""The line items the AI reads from a receipt."""

import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.extraction.checks import find_warnings
from app.extraction.extractor import extract_fields
from app.extraction.prompts import SYSTEM_PROMPT
from app.extraction.schemas import MAX_ITEMS, ExtractedFields, ExtractedItem
from app.models import Receipt
from tests.conftest import GOOD_REPLY, FakeLlmClient
from tests.samples import encode, make_text_image
from tests.test_expenses import expense_payload
from tests.test_extraction import fields

# Milk and bread are not taxed; the dish soap is. 4.49 + 3.99 = 8.48, the
# subtotal in GOOD_REPLY... minus the soap, which the tests add when needed.
MILK = {"name": "2% MILK 4L", "quantity": None, "price": "4.49", "is_taxable": False}
BREAD = {"name": "BREAD WW", "quantity": 1, "price": "3.99", "is_taxable": False}


def reply_with_items(*items: dict) -> str:
    """GOOD_REPLY (subtotal 8.48) with these item lines added."""
    return json.dumps({**json.loads(GOOD_REPLY), "items": list(items)})


def item(price: str, **overrides) -> ExtractedItem:
    values = {"name": "ITEM", "quantity": None, "price": Decimal(price), "is_taxable": None}
    return ExtractedItem(**{**values, **overrides})


# --- reading items from the AI's reply ---


def test_items_are_read_in_order_with_typed_values(fake_llm: FakeLlmClient):
    fake_llm.replies = [reply_with_items(MILK, BREAD)]

    result = extract_fields("LOBLAWS ...", fake_llm)

    assert [entry.name for entry in result.items] == ["2% MILK 4L", "BREAD WW"]
    assert result.items[0].price == Decimal("4.49")
    assert result.items[0].quantity is None
    assert result.items[0].is_taxable is False
    assert result.items[1].quantity == 1


def test_a_discount_is_an_item_with_a_negative_price(fake_llm: FakeLlmClient):
    coupon = {"name": "COUPON", "quantity": None, "price": "-1.00", "is_taxable": None}
    fake_llm.replies = [reply_with_items(MILK, coupon)]

    result = extract_fields("LOBLAWS ...", fake_llm)

    assert result.items[1].price == Decimal("-1.00")


@pytest.mark.parametrize(
    "bad_item",
    [
        {**MILK, "price": "4.499"},  # too many decimal places
        {**MILK, "price": "four"},
        {**MILK, "name": ""},
        {**MILK, "quantity": 0},
        {**MILK, "is_taxable": "maybe"},
    ],
)
def test_a_bad_item_fails_validation_and_triggers_the_retry(
    fake_llm: FakeLlmClient, bad_item: dict
):
    fake_llm.replies = [reply_with_items(bad_item), reply_with_items(MILK, BREAD)]

    result = extract_fields("LOBLAWS ...", fake_llm)

    assert len(result.items) == 2
    assert len(fake_llm.user_messages) == 2
    # The retry tells the model which item was wrong.
    assert "items.0" in fake_llm.user_messages[1]


def test_a_runaway_list_of_items_is_rejected():
    too_many = [item("1.00")] * (MAX_ITEMS + 1)

    with pytest.raises(ValidationError):
        fields(items=too_many)


def test_items_are_required_in_the_schema_sent_to_the_model():
    schema = ExtractedFields.model_json_schema()

    # Required means the model cannot leave the list out; it sends [] instead.
    assert "items" in schema["required"]


def test_a_reply_or_saved_receipt_without_items_loads_as_an_empty_list():
    # This is what receipts saved before this feature look like.
    loaded = ExtractedFields.model_validate_json(GOOD_REPLY)

    assert loaded.items == []


def test_the_prompt_explains_items():
    for phrase in ("items", "negative price", "is_taxable", "whole line", "empty list"):
        assert phrase in SYSTEM_PROMPT


# --- the check that items add up ---


def test_items_that_add_up_to_the_subtotal_have_no_warning():
    assert find_warnings(fields(items=[item("4.49"), item("3.99")])) == []


def test_items_within_two_cents_of_the_subtotal_are_accepted():
    assert find_warnings(fields(items=[item("4.49"), item("4.01")])) == []


def test_items_that_do_not_add_up_are_flagged():
    warnings = find_warnings(fields(items=[item("4.49")]))

    assert warnings == [
        "The items add up to 4.49, but the subtotal is 8.48. An item may be missing or misread."
    ]


def test_a_discount_counts_towards_the_items_total():
    with_discount = [item("4.49"), item("4.99"), item("-1.00")]

    assert find_warnings(fields(items=with_discount)) == []


def test_items_are_not_checked_without_a_subtotal_or_without_items():
    assert find_warnings(fields(items=[item("1.00")], subtotal=None)) == []
    assert find_warnings(fields(items=[])) == []


# --- through the API ---


def upload(client: TestClient) -> dict:
    files = {"file": ("receipt.png", encode(make_text_image(), ".png"), "image/png")}
    return client.post("/receipts", files=files).json()


def test_upload_returns_and_stores_the_items(
    client: TestClient, fake_llm: FakeLlmClient, db_session: Session
):
    fake_llm.replies = [reply_with_items(MILK, BREAD)]

    receipt = upload(client)

    assert receipt["extracted_fields"]["items"] == [MILK, BREAD]
    assert receipt["warnings"] == []
    # They are saved with the rest of the AI's answer, so reading the receipt
    # again later gives the same items.
    assert client.get(f"/receipts/{receipt['id']}").json()["extracted_fields"]["items"] == [
        MILK,
        BREAD,
    ]
    stored = db_session.get(Receipt, receipt["id"])
    assert stored.extracted_fields["items"][0]["price"] == "4.49"


def test_upload_warns_when_the_items_do_not_add_up(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.replies = [reply_with_items(MILK)]

    receipt = upload(client)

    assert receipt["needs_review"] is True
    assert "The items add up to 4.49" in receipt["warnings"][0]


def test_a_receipt_saved_before_items_existed_still_works(client: TestClient, db_session: Session):
    receipt = upload(client)  # GOOD_REPLY has no "items" key, like old receipts
    stored = db_session.get(Receipt, receipt["id"])
    assert "items" not in json.loads(GOOD_REPLY)

    assert client.get(f"/receipts/{stored.id}").json()["extracted_fields"]["items"] == []
    # Saving an expense from it still compares against the AI's values.
    payload = expense_payload(subtotal="8.48", tax="1.10", total="9.58", receipt_id=stored.id)
    expense = client.post("/expenses", json=payload).json()
    assert expense["was_edited"] is False


def test_items_do_not_count_as_an_edit_of_the_expense(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.replies = [reply_with_items(MILK, BREAD)]
    receipt = upload(client)

    payload = expense_payload(subtotal="8.48", tax="1.10", total="9.58", receipt_id=receipt["id"])
    expense = client.post("/expenses", json=payload).json()

    assert expense["was_edited"] is False
