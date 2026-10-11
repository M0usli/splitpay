"""The arithmetic for splitting shared expenses among a household.

Everything here uses Decimal, and every amount is a whole number of cents.
These are plain functions with no database or web code, so they are easy to
test.
"""

from collections.abc import Iterable
from decimal import ROUND_DOWN, Decimal

from app.models import Expense, Settlement

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def split_equally(total: Decimal, people: int) -> list[Decimal]:
    """Split a total into equal parts that add up to exactly the total.

    10.00 among 3 people cannot be 3.333... each. Everyone gets the amount
    rounded down to the cent (3.33), and the cents left over (here one) go to
    the first people in the list, one cent each: [3.34, 3.33, 3.33].
    """
    base = (total / people).quantize(CENT, rounding=ROUND_DOWN)
    leftover_cents = int((total - base * people) / CENT)
    return [base + CENT if position < leftover_cents else base for position in range(people)]


def net_balances(
    member_ids: Iterable[int],
    expenses: Iterable[Expense],
    settlements: Iterable[Settlement] = (),
) -> dict[int, Decimal]:
    """For each member: what they are owed minus what they owe.

    Positive means the household owes this person money; negative means this
    person owes money. For every share that is not the payer's own, the payer
    goes up by that amount and the share's owner goes down by it, so the
    numbers always add up to zero.

    A settlement is money paid back: the person who paid goes up (they owe
    less) and the person who received it goes down (they are owed less).

    Shares and settlements of people who are no longer members are left out.
    """
    balances = {member_id: ZERO for member_id in member_ids}
    for expense in expenses:
        payer_id = expense.user_id
        if payer_id not in balances:
            continue
        for share in expense.shares:
            if share.user_id == payer_id or share.user_id not in balances:
                continue
            balances[payer_id] += share.amount
            balances[share.user_id] -= share.amount
    for settlement in settlements:
        if settlement.from_user_id in balances and settlement.to_user_id in balances:
            balances[settlement.from_user_id] += settlement.amount
            balances[settlement.to_user_id] -= settlement.amount
    return balances


def plan_payments(balances: dict[int, Decimal]) -> list[tuple[int, int, Decimal]]:
    """Turn net balances into a short list of (from, to, amount) payments.

    Who paid for what no longer matters once everything is netted: only how
    much each person is up or down. The person who owes the most pays the
    person who is owed the most, as much as possible, and this repeats until
    everyone is at zero. With N people this needs at most N - 1 payments.
    """
    # Largest amounts first; the id breaks ties so the result is always the same.
    debtors = sorted(
        ([member_id, -amount] for member_id, amount in balances.items() if amount < 0),
        key=lambda entry: (-entry[1], entry[0]),
    )
    creditors = sorted(
        ([member_id, amount] for member_id, amount in balances.items() if amount > 0),
        key=lambda entry: (-entry[1], entry[0]),
    )

    payments = []
    debtor_index = creditor_index = 0
    while debtor_index < len(debtors) and creditor_index < len(creditors):
        debtor, creditor = debtors[debtor_index], creditors[creditor_index]
        amount = min(debtor[1], creditor[1])
        payments.append((debtor[0], creditor[0], amount))
        debtor[1] -= amount
        creditor[1] -= amount
        # Whoever reached zero is done; move on to the next person.
        if debtor[1] == 0:
            debtor_index += 1
        if creditor[1] == 0:
            creditor_index += 1
    return payments
