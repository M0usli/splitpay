"""Turning the bank's category for a transaction into one of this app's categories."""

from app.enums import Category

# Plaid's top-level categories. Anything not listed becomes "Other".
BY_PRIMARY = {
    "FOOD_AND_DRINK": Category.DINING,
    "TRANSPORTATION": Category.TRANSPORT,
    "TRAVEL": Category.TRANSPORT,
    "GENERAL_MERCHANDISE": Category.SHOPPING,
    "HOME_IMPROVEMENT": Category.SHOPPING,
    "PERSONAL_CARE": Category.SHOPPING,
    "ENTERTAINMENT": Category.ENTERTAINMENT,
    "RENT_AND_UTILITIES": Category.BILLS_UTILITIES,
    "LOAN_PAYMENTS": Category.BILLS_UTILITIES,
    "MEDICAL": Category.HEALTH,
}

# A few detailed categories that belong somewhere else than their group.
BY_DETAILED = {
    "FOOD_AND_DRINK_GROCERIES": Category.GROCERIES,
}


def suggest_category(primary: str | None, detailed: str | None) -> Category:
    """The best fit for a bank transaction. It is only a suggestion the user can change."""
    if detailed in BY_DETAILED:
        return BY_DETAILED[detailed]
    return BY_PRIMARY.get(primary or "", Category.OTHER)
