"""Deciding whether a predicted value counts as correct."""

import re
from difflib import SequenceMatcher
from typing import Any

# Two merchant names match when they are at least this similar (0 to 1).
MERCHANT_MATCH_THRESHOLD = 0.8


def normalize_merchant(name: str) -> str:
    """Lowercase, and turn punctuation and repeated spaces into single spaces."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def merchant_similarity(expected: str, predicted: str) -> float:
    """How alike two merchant names are, from 0 (nothing in common) to 1 (same).

    This is a "fuzzy" match: "FRESHCO" and "FreshCo" score 1.0, and
    "Tim Hortons #2417" and "Tim Hortons" still score above the threshold.
    """
    return SequenceMatcher(
        None, normalize_merchant(expected), normalize_merchant(predicted)
    ).ratio()


def is_correct(field: str, expected: Any, predicted: Any) -> bool:
    """Compare one field. `None` means "not on the receipt" on either side."""
    if expected is None or predicted is None:
        return expected is None and predicted is None
    if field == "merchant":
        return merchant_similarity(expected, predicted) >= MERCHANT_MATCH_THRESHOLD
    # Dates, amounts and categories must match exactly. Decimal("1.6") equals
    # Decimal("1.60"), so a missing trailing zero in the labels is fine.
    return expected == predicted
