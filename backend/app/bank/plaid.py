"""The Plaid client. It only ever talks to Plaid's SANDBOX."""

import datetime
from decimal import Decimal
from typing import Any

import httpx2

from app.bank.base import BankError, BankTransactionData, SyncResult

# The sandbox has pretend banks with pretend accounts and transactions. This
# address is fixed here on purpose and there is no setting to change it, so
# this app cannot be pointed at real bank accounts by mistake.
PLAID_SANDBOX_URL = "https://sandbox.plaid.com"

REQUEST_TIMEOUT_SECONDS = 30.0
# How many transactions to ask for per request, and how many requests one
# sync may make. Together they stop a sync from running forever.
PAGE_SIZE = 250
MAX_PAGES = 20


class PlaidClient:
    """Calls Plaid's HTTP API directly. Every call is a POST with a JSON body."""

    def __init__(
        self, client_id: str, secret: str, transport: httpx2.BaseTransport | None = None
    ) -> None:
        self._client_id = client_id
        self._secret = secret
        # `transport` lets tests answer the requests themselves instead of
        # going to the internet.
        self._transport = transport

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        if not self._client_id or not self._secret:
            raise BankError(
                "The bank connection is not set up. Add PLAID_CLIENT_ID and PLAID_SECRET "
                "(sandbox keys) to the .env file."
            )
        # The keys identify this app to Plaid. They go in the body of every
        # request and never reach the browser.
        payload = {"client_id": self._client_id, "secret": self._secret, **body}
        try:
            with httpx2.Client(
                base_url=PLAID_SANDBOX_URL,
                timeout=REQUEST_TIMEOUT_SECONDS,
                transport=self._transport,
            ) as client:
                response = client.post(path, json=payload)
        except httpx2.HTTPError as error:
            raise BankError("Could not reach the bank service.") from error

        if response.status_code >= 400:
            raise BankError(self._describe_error(response))
        return response.json()

    @staticmethod
    def _describe_error(response: httpx2.Response) -> str:
        """Turn Plaid's error reply into a message for the user."""
        try:
            code = response.json().get("error_code", "")
        except ValueError:
            code = ""
        if code in ("INVALID_API_KEYS", "INVALID_CLIENT_ID", "INVALID_SECRET"):
            return "The bank service rejected the keys. Check PLAID_CLIENT_ID and PLAID_SECRET."
        if code == "ITEM_LOGIN_REQUIRED":
            return "This bank connection has expired. Remove it and connect the bank again."
        suffix = f" ({code})" if code else ""
        return f"The bank service returned an error{suffix}."

    def create_link_token(self, user_id: int) -> str:
        reply = self._post(
            "/link/token/create",
            {
                "client_name": "Receipt Tracker",
                "language": "en",
                "country_codes": ["CA", "US"],
                "products": ["transactions"],
                # Any stable id for the person connecting; ours is the user's id.
                "user": {"client_user_id": str(user_id)},
            },
        )
        return reply["link_token"]

    def exchange_public_token(self, public_token: str) -> tuple[str, str]:
        reply = self._post("/item/public_token/exchange", {"public_token": public_token})
        return reply["access_token"], reply["item_id"]

    def sync_transactions(self, access_token: str, cursor: str | None) -> SyncResult:
        result = SyncResult(next_cursor=cursor or "")
        for _page in range(MAX_PAGES):
            body: dict[str, Any] = {"access_token": access_token, "count": PAGE_SIZE}
            if result.next_cursor:
                body["cursor"] = result.next_cursor
            reply = self._post("/transactions/sync", body)

            result.added.extend(to_transaction(item) for item in reply.get("added", []))
            result.removed_ids.extend(item["transaction_id"] for item in reply.get("removed", []))
            result.next_cursor = reply.get("next_cursor", result.next_cursor)
            if not reply.get("has_more", False):
                break
        return result


def to_transaction(item: dict[str, Any]) -> BankTransactionData:
    """Pick the fields this app uses out of one Plaid transaction."""
    category = item.get("personal_finance_category") or {}
    return BankTransactionData(
        transaction_id=item["transaction_id"],
        # merchant_name is the tidy name ("Starbucks"); name is the raw
        # statement line, used when Plaid has no tidy one.
        name=item.get("merchant_name") or item.get("name") or "Unknown",
        # str() first: turning a JSON number into Decimal directly would
        # carry over its floating-point error.
        amount=Decimal(str(item["amount"])),
        currency=item.get("iso_currency_code"),
        date=datetime.date.fromisoformat(item["date"]),
        pending=bool(item.get("pending", False)),
        category=category.get("primary"),
        detailed_category=category.get("detailed"),
    )
