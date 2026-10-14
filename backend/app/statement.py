"""A month of wallet history as a CSV file, the kind a spreadsheet opens.

It reads the ledger only; nothing is stored for a statement. The opening
balance is everything before the month, and each line carries the balance
after it, so the last line must equal the closing balance.
"""

import csv
import datetime
import io
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.dates import month_range
from app.enums import TransferKind
from app.models import User, Wallet, WalletTransfer

HEADER = ["Date", "Description", "Other party", "Note", "Money in", "Money out", "Balance"]

# What each kind of transfer is called on a statement: (when it left, when it arrived).
DESCRIPTIONS = {
    TransferKind.TOP_UP: ("Added money", "Added money"),
    TransferKind.SEND: ("Sent", "Received"),
    TransferKind.SETTLEMENT: ("Split bill paid", "Split bill received"),
    TransferKind.REQUEST: ("Request paid", "Request received"),
    TransferKind.BILL: ("Bill payment", "Bill payment"),
}


def month_bounds(month: str) -> tuple[datetime.datetime, datetime.datetime]:
    """The first moment of "YYYY-MM" and of the month after it, in UTC."""
    start, end = month_range(month)
    midnight = datetime.time(tzinfo=datetime.UTC)
    return datetime.datetime.combine(start, midnight), datetime.datetime.combine(end, midnight)


def safe_cell(text: str | None) -> str:
    """Text that a spreadsheet will show as text.

    A cell that starts with =, +, - or @ is run as a formula by Excel and
    others. A note such as "=HYPERLINK(...)" written by another user would
    then run on the reader's computer. A leading apostrophe makes it plain
    text. This attack is called CSV injection.
    """
    if text is None:
        return ""
    return f"'{text}" if text.startswith(("=", "+", "-", "@", "\t", "\r")) else text


def balance_before(db: Session, wallet: Wallet, moment: datetime.datetime) -> Decimal:
    """The wallet's balance just before `moment`."""
    money_in = db.scalar(
        select(func.coalesce(func.sum(WalletTransfer.amount), 0))
        .where(WalletTransfer.to_wallet_id == wallet.id)
        .where(WalletTransfer.created_at < moment)
    )
    money_out = db.scalar(
        select(func.coalesce(func.sum(WalletTransfer.amount), 0))
        .where(WalletTransfer.from_wallet_id == wallet.id)
        .where(WalletTransfer.created_at < moment)
    )
    return Decimal(money_in) - Decimal(money_out)


def build_statement(db: Session, wallet: Wallet, month: str) -> str:
    """The CSV text of one month's statement, oldest line first."""
    start, end = month_bounds(month)
    transfers = db.scalars(
        select(WalletTransfer)
        .where(
            or_(
                WalletTransfer.from_wallet_id == wallet.id,
                WalletTransfer.to_wallet_id == wallet.id,
            )
        )
        .where(WalletTransfer.created_at >= start)
        .where(WalletTransfer.created_at < end)
        .order_by(WalletTransfer.created_at, WalletTransfer.id)
    ).all()

    # The emails of the other wallets' owners, looked up once.
    other_ids = {
        transfer.from_wallet_id if transfer.to_wallet_id == wallet.id else transfer.to_wallet_id
        for transfer in transfers
    }
    emails = dict(
        db.execute(
            select(Wallet.id, User.email)
            .join(User, User.id == Wallet.user_id)
            .where(Wallet.id.in_(other_ids))
        ).all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(HEADER)
    balance = balance_before(db, wallet, start)
    writer.writerow([start.date().isoformat(), "Opening balance", "", "", "", "", f"{balance:.2f}"])
    for transfer in transfers:
        came_in = transfer.to_wallet_id == wallet.id
        other_id = transfer.from_wallet_id if came_in else transfer.to_wallet_id
        balance += transfer.amount if came_in else -transfer.amount
        writer.writerow(
            [
                transfer.created_at.astimezone(datetime.UTC).date().isoformat(),
                DESCRIPTIONS[transfer.kind][1 if came_in else 0],
                safe_cell(emails.get(other_id)),
                safe_cell(transfer.note),
                f"{transfer.amount:.2f}" if came_in else "",
                "" if came_in else f"{transfer.amount:.2f}",
                f"{balance:.2f}",
            ]
        )
    last_day = end - datetime.timedelta(days=1)
    writer.writerow(
        [last_day.date().isoformat(), "Closing balance", "", "", "", "", f"{balance:.2f}"]
    )
    return output.getvalue()
