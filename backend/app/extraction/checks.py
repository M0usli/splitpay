"""Sanity checks on extracted fields. Problems are reported, never auto-corrected."""

from decimal import Decimal

from app.extraction.schemas import ExtractedFields

# Receipts round each line, so allow subtotal + tax to be off by up to 2 cents.
TOTAL_TOLERANCE = Decimal("0.02")


def find_warnings(fields: ExtractedFields) -> list[str]:
    """Return messages for anything the user should double-check."""
    warnings = []

    if fields.merchant is None:
        warnings.append("The merchant name could not be found.")
    if fields.date is None:
        warnings.append("The date could not be found.")
    if fields.total is None:
        warnings.append("The total could not be found.")

    if fields.subtotal is not None and fields.tax is not None and fields.total is not None:
        expected_total = fields.subtotal + fields.tax
        if abs(expected_total - fields.total) > TOTAL_TOLERANCE:
            warnings.append(
                f"Subtotal + tax is {expected_total}, but the total is {fields.total}. "
                "One of these amounts may have been misread."
            )

    return warnings
