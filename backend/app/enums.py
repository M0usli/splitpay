"""Fixed sets of values shared by the database models and the API schemas."""

from enum import StrEnum


class Category(StrEnum):
    GROCERIES = "Groceries"
    DINING = "Dining"
    TRANSPORT = "Transport"
    SHOPPING = "Shopping"
    ENTERTAINMENT = "Entertainment"
    BILLS_UTILITIES = "Bills & Utilities"
    HEALTH = "Health"
    OTHER = "Other"


class BankTransactionStatus(StrEnum):
    """What the user decided about a transaction imported from a bank."""

    NEW = "new"  # waiting for a decision
    ADDED = "added"  # made into an expense
    IGNORED = "ignored"  # not something to track


class TransferKind(StrEnum):
    """Why money moved between two wallets."""

    TOP_UP = "top_up"  # pretend money added from outside
    SEND = "send"  # one user sent money to another
    SETTLEMENT = "settlement"  # paying back a split-bill debt to a housemate
    REQUEST = "request"  # paying a request for money


class MoneyRequestStatus(StrEnum):
    """Where a request for money stands."""

    PENDING = "pending"  # waiting for the person who was asked
    PAID = "paid"
    DECLINED = "declined"  # the person who was asked said no
    CANCELLED = "cancelled"  # the person who asked took it back


class ReceiptStatus(StrEnum):
    PENDING = "pending"
    EXTRACTED = "extracted"
    FAILED = "failed"
