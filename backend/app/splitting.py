"""The arithmetic for splitting shared expenses between two people.

Everything here uses Decimal, and every amount is a whole number of cents.
"""

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from app.models import Expense

CENT = Decimal("0.01")


def split_total(total: Decimal, payer_share_percent: Decimal) -> tuple[Decimal, Decimal]:
    """Split a total into (the payer's part, the other person's part).

    Only the payer's part is rounded. The other part is whatever is left, so
    the two always add up to exactly the total and no cent is lost or
    invented. For example 10.01 at 50% gives 5.01 and 5.00.
    """
    # ROUND_HALF_UP is the rounding taught at school: 0.005 becomes 0.01.
    # Python's default rounds halves to the nearest even digit instead.
    payer_part = (total * payer_share_percent / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    return payer_part, total - payer_part


def amount_owed_to(payer_id: int, shared_expenses: Iterable[Expense]) -> Decimal:
    """How much the other member owes `payer_id` once both sides are counted.

    Each shared expense puts the other person's part on the payer's side. A
    positive result means the other member owes `payer_id`; a negative one
    means `payer_id` owes them.
    """
    balance = Decimal("0.00")
    for expense in shared_expenses:
        _, other_part = split_total(expense.total, expense.payer_share_percent)
        if expense.user_id == payer_id:
            balance += other_part
        else:
            balance -= other_part
    return balance
