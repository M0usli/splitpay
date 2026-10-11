"""Tests for LLM extraction. The model is always faked: no test calls the real API."""

import datetime
from decimal import Decimal
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from app.enums import Category
from app.extraction.base import ExtractionError
from app.extraction.checks import find_warnings
from app.extraction.claude import ClaudeClient
from app.extraction.extractor import extract_fields
from app.extraction.prompts import SYSTEM_PROMPT, build_retry_message, build_user_message
from app.extraction.schemas import ExtractedFields
from tests.conftest import GOOD_REPLY, FakeLlmClient

NEGATIVE_TOTAL_REPLY = GOOD_REPLY.replace('"9.58"', '"-9.58"')


def fields(**overrides) -> ExtractedFields:
    values = {
        "merchant": "Loblaws",
        "date": datetime.date(2026, 10, 5),
        "subtotal": Decimal("8.48"),
        "tax": Decimal("1.10"),
        "total": Decimal("9.58"),
        "currency": None,
        "category": Category.GROCERIES,
    }
    values.update(overrides)
    return ExtractedFields(**values)


# --- extract_fields: validation and the single retry ---


def test_valid_reply_becomes_typed_fields(fake_llm: FakeLlmClient):
    result = extract_fields("LOBLAWS ...", fake_llm)

    assert result.merchant == "Loblaws"
    assert result.date == datetime.date(2026, 10, 5)
    assert result.total == Decimal("9.58")
    assert result.currency is None
    assert result.category is Category.GROCERIES
    assert len(fake_llm.user_messages) == 1


def test_receipt_text_is_wrapped_in_tags_in_the_prompt(fake_llm: FakeLlmClient):
    extract_fields("LOBLAWS\nTOTAL 9.58", fake_llm)

    assert fake_llm.user_messages[0] == "<receipt_text>\nLOBLAWS\nTOTAL 9.58\n</receipt_text>"


def test_invalid_reply_is_retried_once_and_then_succeeds(fake_llm: FakeLlmClient):
    fake_llm.replies = [NEGATIVE_TOTAL_REPLY, GOOD_REPLY]

    result = extract_fields("LOBLAWS ...", fake_llm)

    assert result.total == Decimal("9.58")
    assert len(fake_llm.user_messages) == 2
    # The retry tells the model which field was wrong.
    assert "failed validation" in fake_llm.user_messages[1]
    assert "total" in fake_llm.user_messages[1]


def test_two_invalid_replies_raise_an_error(fake_llm: FakeLlmClient):
    fake_llm.replies = [NEGATIVE_TOTAL_REPLY, NEGATIVE_TOTAL_REPLY]

    with pytest.raises(ExtractionError, match="did not match the expected format"):
        extract_fields("LOBLAWS ...", fake_llm)

    assert len(fake_llm.user_messages) == 2  # one try plus one retry, no more


@pytest.mark.parametrize(
    "bad_reply",
    [
        "Sure! Here is the JSON you asked for.",  # not JSON at all
        '{"merchant": "Loblaws"}',  # fields missing
        GOOD_REPLY.replace('"Groceries"', '"Gambling"'),  # category not in the list
        GOOD_REPLY.replace('"2026-10-05"', '"October 5th"'),  # date not ISO
        GOOD_REPLY.replace('"9.58"', '"9.581"'),  # too many decimal places
    ],
)
def test_reply_that_breaks_the_schema_is_rejected(fake_llm: FakeLlmClient, bad_reply: str):
    fake_llm.replies = [bad_reply, bad_reply]

    with pytest.raises(ExtractionError):
        extract_fields("LOBLAWS ...", fake_llm)


def test_null_fields_are_accepted(fake_llm: FakeLlmClient):
    fake_llm.replies = [
        '{"merchant": null, "date": null, "subtotal": null, "tax": null, '
        '"total": null, "currency": null, "category": null}'
    ]

    result = extract_fields("unreadable", fake_llm)

    assert result.merchant is None
    assert result.total is None


# --- sanity checks ---


def test_consistent_fields_have_no_warnings():
    assert find_warnings(fields()) == []


@pytest.mark.parametrize("total", ["9.56", "9.57", "9.58", "9.59", "9.60"])
def test_total_within_two_cents_is_accepted(total: str):
    assert find_warnings(fields(total=Decimal(total))) == []


@pytest.mark.parametrize("total", ["9.55", "9.61", "19.58"])
def test_total_off_by_more_than_two_cents_is_flagged(total: str):
    warnings = find_warnings(fields(total=Decimal(total)))

    assert len(warnings) == 1
    assert "Subtotal + tax is 9.58" in warnings[0]


def test_arithmetic_is_not_checked_when_an_amount_is_missing():
    assert find_warnings(fields(tax=None)) == []
    assert find_warnings(fields(subtotal=None)) == []


def test_missing_key_fields_are_flagged():
    warnings = find_warnings(fields(merchant=None, date=None, total=None))

    assert warnings == [
        "The merchant name could not be found.",
        "The date could not be found.",
        "The total could not be found.",
    ]


# --- prompt ---


def test_system_prompt_covers_the_requirements():
    for category in Category:
        assert category.value in SYSTEM_PROMPT
    for tax_label in ("HST", "GST", "TAX"):
        assert tax_label in SYSTEM_PROMPT
    assert "YYYY-MM-DD" in SYSTEM_PROMPT
    assert "Never guess" in SYSTEM_PROMPT


def test_retry_message_includes_the_receipt_and_the_problem():
    message = build_retry_message("TOTAL 9.58", "total: must be >= 0")

    assert build_user_message("TOTAL 9.58") in message
    assert "total: must be >= 0" in message


# --- ClaudeClient (the Anthropic SDK is replaced by a fake) ---


class FakeAnthropic:
    """Replaces anthropic.Anthropic. Records the request and returns a canned response."""

    response = None
    error: Exception | None = None
    last_request: dict = {}

    def __init__(self, **kwargs) -> None:
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **request):
        FakeAnthropic.last_request = request
        if FakeAnthropic.error is not None:
            raise FakeAnthropic.error
        return FakeAnthropic.response


def sdk_response(text: str = GOOD_REPLY, stop_reason: str = "end_turn") -> SimpleNamespace:
    return SimpleNamespace(
        stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)]
    )


def http_error(error_class: type[anthropic.APIStatusError], status: int) -> Exception:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return error_class("error", response=httpx2.Response(status, request=request), body=None)


@pytest.fixture
def fake_sdk(monkeypatch: pytest.MonkeyPatch) -> type[FakeAnthropic]:
    FakeAnthropic.response = sdk_response()
    FakeAnthropic.error = None
    FakeAnthropic.last_request = {}
    monkeypatch.setattr(anthropic, "Anthropic", FakeAnthropic)
    return FakeAnthropic


def test_claude_client_returns_the_reply_text(fake_sdk: type[FakeAnthropic]):
    client = ClaudeClient(api_key="test-key", model="claude-test")

    reply = client.complete_json("system prompt", "user prompt", ExtractedFields)

    assert reply == GOOD_REPLY
    request = fake_sdk.last_request
    assert request["model"] == "claude-test"
    assert request["system"] == "system prompt"
    assert request["messages"] == [{"role": "user", "content": "user prompt"}]
    schema = request["output_config"]["format"]["schema"]
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert set(schema["properties"]) == set(ExtractedFields.model_fields)


def test_claude_client_requires_an_api_key(fake_sdk: type[FakeAnthropic]):
    client = ClaudeClient(api_key="", model="claude-test")

    with pytest.raises(ExtractionError, match="ANTHROPIC_API_KEY is not set"):
        client.complete_json("system", "user", ExtractedFields)

    assert fake_sdk.last_request == {}  # nothing was sent


@pytest.mark.parametrize(
    ("stop_reason", "message"),
    [("refusal", "declined"), ("max_tokens", "cut off")],
)
def test_claude_client_reports_unusable_replies(
    fake_sdk: type[FakeAnthropic], stop_reason: str, message: str
):
    fake_sdk.response = sdk_response(stop_reason=stop_reason)
    client = ClaudeClient(api_key="test-key", model="claude-test")

    with pytest.raises(ExtractionError, match=message):
        client.complete_json("system", "user", ExtractedFields)


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (http_error(anthropic.AuthenticationError, 401), "API key was rejected"),
        (http_error(anthropic.RateLimitError, 429), "rate limited"),
        (http_error(anthropic.InternalServerError, 500), "status 500"),
        (
            anthropic.APIConnectionError(
                request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
            ),
            "Could not reach",
        ),
    ],
)
def test_claude_client_turns_sdk_errors_into_clear_messages(
    fake_sdk: type[FakeAnthropic], error: Exception, message: str
):
    fake_sdk.error = error
    client = ClaudeClient(api_key="test-key", model="claude-test")

    with pytest.raises(ExtractionError, match=message):
        client.complete_json("system", "user", ExtractedFields)
