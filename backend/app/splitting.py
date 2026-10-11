"""The arithmetic for splitting shared expenses among a household.

Everything here uses Decimal, and every amount is a whole number of cents.
These are plain functions with no database or web code, so they are easy to
test.
"""

from collections.abc import Iterable
from dataclasses import dataclass
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


def split_in_proportion(amount: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split an amount among people in proportion to their weights.

    Everyone first gets their exact part rounded down to the cent. The cents
    still missing go, one each, to the people who lost the largest fraction
    of a cent to that rounding, so the parts add up to exactly the amount.

    A negative amount (money to take off) is split the same way and negated.
    Weights below zero count as zero. If every weight is zero the amount is
    split equally.
    """
    if amount < 0:
        return [-part for part in split_in_proportion(-amount, weights)]
    weights = [max(weight, ZERO) for weight in weights]
    total_weight = sum(weights)
    if total_weight == 0:
        return split_equally(amount, len(weights))

    exact = [amount * weight / total_weight for weight in weights]
    parts = [value.quantize(CENT, rounding=ROUND_DOWN) for value in exact]
    missing_cents = int((amount - sum(parts)) / CENT)
    # The biggest lost fraction first; the position breaks ties.
    by_largest_loss = sorted(
        range(len(parts)), key=lambda position: (parts[position] - exact[position], position)
    )
    for position in by_largest_loss[:missing_cents]:
        parts[position] += CENT
    return parts


@dataclass
class PersonSplit:
    """What one person pays of a receipt split item by item."""

    items: Decimal = ZERO
    tax: Decimal = ZERO
    # Their part of any difference between the items plus tax and the total.
    adjustment: Decimal = ZERO

    @property
    def amount(self) -> Decimal:
        return self.items + self.tax + self.adjustment


@dataclass
class ItemLine:
    """One line of a receipt and the people who share it."""

    price: Decimal
    is_taxable: bool
    shared_by: list[int]


def split_by_items(
    lines: list[ItemLine], tax: Decimal, total: Decimal, payer_id: int
) -> dict[int, PersonSplit]:
    """Work out what each person pays when a receipt is split item by item.

    1. Each line's price is divided equally among the people who share it.
    2. The tax is divided in proportion to each person's part of the taxed
       lines, so someone who bought only untaxed food pays no tax. If no line
       is marked as taxed, the tax follows everyone's part of all the lines.
    3. Whatever is left between (items + tax) and the total, for example a
       bag fee that is not a line, is spread in proportion to what each
       person already pays.

    The amounts always add up to exactly `total`. Raises ValueError if
    someone would end up below zero, which can happen when a discount is
    given to a person who shares nothing else.
    """
    people: dict[int, PersonSplit] = {}
    taxed_parts: dict[int, Decimal] = {}

    for line in lines:
        # The payer first, so a cent that cannot be divided lands on them.
        sharers = sorted(set(line.shared_by), key=lambda person: (person != payer_id, person))
        sign = -1 if line.price < 0 else 1
        for person, part in zip(sharers, split_equally(abs(line.price), len(sharers)), strict=True):
            people.setdefault(person, PersonSplit()).items += sign * part
            if line.is_taxable:
                taxed_parts[person] = taxed_parts.get(person, ZERO) + sign * part

    order = sorted(people, key=lambda person: (person != payer_id, person))
    if not order:
        raise ValueError("there are no items to split")

    any_taxed = any(line.is_taxable for line in lines)
    tax_weights = [taxed_parts.get(p, ZERO) if any_taxed else people[p].items for p in order]
    for person, part in zip(order, split_in_proportion(tax, tax_weights), strict=True):
        people[person].tax = part

    difference = total - sum(people[p].items + people[p].tax for p in order)
    so_far = [people[p].items + people[p].tax for p in order]
    for person, part in zip(order, split_in_proportion(difference, so_far), strict=True):
        people[person].adjustment = part

    if any(split.amount < 0 for split in people.values()):
        raise ValueError(
            "someone would pay less than nothing; check who the discounts are assigned to"
        )
    return people
