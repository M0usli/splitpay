"""Database models. Importing this package registers every table on Base."""

from app.models.bank import BankConnection, BankTransaction
from app.models.base import Base
from app.models.bill import BillPayment, SavedBiller
from app.models.expense import Expense, ExpenseShare
from app.models.household import Household, Settlement
from app.models.identity import IdentityVerification
from app.models.notification import Notification
from app.models.pin import PaymentPin
from app.models.receipt import Receipt
from app.models.recurring import RecurringExpense
from app.models.two_step import TwoStepLogin
from app.models.user import User, UserSession
from app.models.wallet import MoneyRequest, Wallet, WalletTransfer

__all__ = [
    "BankConnection",
    "BankTransaction",
    "Base",
    "BillPayment",
    "Expense",
    "ExpenseShare",
    "Household",
    "IdentityVerification",
    "MoneyRequest",
    "Notification",
    "PaymentPin",
    "Receipt",
    "RecurringExpense",
    "SavedBiller",
    "Settlement",
    "TwoStepLogin",
    "User",
    "UserSession",
    "Wallet",
    "WalletTransfer",
]
