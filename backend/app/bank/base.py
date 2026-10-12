"""The interface a bank-data client has to follow, and what it returns."""

import datetime
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol


class BankError(Exception):
    """Talking to the bank-data provider failed. The message is safe to show to the user."""


@dataclass
class BankTransactionData:
    """One transaction as the provider reports it."""

    transaction_id: str
    name: str
    # Positive means money left the account (a purchase); negative means
    # money came in (a deposit or a refund).
    amount: Decimal
    currency: str | None
    date: datetime.date
    # Not final yet. The bank may still change or drop it.
    pending: bool
    # The provider's own category, for example "FOOD_AND_DRINK".
    category: str | None
    detailed_category: str | None


@dataclass
class SyncResult:
    """What changed at the bank since the last sync."""

    added: list[BankTransactionData] = field(default_factory=list)
    # Ids of transactions the bank has withdrawn.
    removed_ids: list[str] = field(default_factory=list)
    # A bookmark: sending it next time returns only what is new since now.
    next_cursor: str = ""


class BankClient(Protocol):
    """Anything that can connect a bank and list its transactions.

    Like LlmClient, this is a Protocol so the real Plaid client can be
    replaced by a fake in tests.
    """

    def create_link_token(self, user_id: int) -> str:
        """Start a connection. The token opens the provider's "choose your bank" window."""
        ...

    def exchange_public_token(self, public_token: str) -> tuple[str, str]:
        """Finish a connection. Returns (access token, the provider's id for the connection)."""
        ...

    def sync_transactions(self, access_token: str, cursor: str | None) -> SyncResult:
        """Everything that changed since `cursor` (None for the first time)."""
        ...
