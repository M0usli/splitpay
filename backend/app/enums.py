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


class ReceiptStatus(StrEnum):
    PENDING = "pending"
    EXTRACTED = "extracted"
    FAILED = "failed"
