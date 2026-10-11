"""Bank connection: importing transactions from a (sandbox) bank."""

from typing import Annotated

from fastapi import Depends

from app.bank.base import BankClient, BankError, BankTransactionData, SyncResult
from app.bank.plaid import PlaidClient
from app.config import SettingsDep

__all__ = [
    "BankClient",
    "BankClientDep",
    "BankError",
    "BankTransactionData",
    "SyncResult",
    "get_bank_client",
]


def get_bank_client(settings: SettingsDep) -> BankClient:
    """Choose the bank client. Tests override this with a fake."""
    return PlaidClient(client_id=settings.plaid_client_id, secret=settings.plaid_secret)


BankClientDep = Annotated[BankClient, Depends(get_bank_client)]
