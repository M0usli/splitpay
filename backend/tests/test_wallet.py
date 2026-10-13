"""The wallet: balance, top-up, sending money, and the ledger behind them.

`client` is logged in as Sam and `other_client` as Alex.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.enums import TransferKind
from app.models import Wallet, WalletTransfer
from app.wallet import InsufficientFunds, get_balance, get_or_create_wallet, move_money
from tests.test_household import ALEX, SAM


def key() -> str:
    """A fresh request id, as the app would make for each action."""
    return uuid.uuid4().hex


def top_up(client: TestClient, amount: str, idempotency_key: str | None = None):
    return client.post(
        "/wallet/top-up", json={"amount": amount, "idempotency_key": idempotency_key or key()}
    )


def send(client: TestClient, to_email: str, amount: str, **extra):
    payload = {"to_email": to_email, "amount": amount, "idempotency_key": key(), **extra}
    return client.post("/wallet/send", json=payload)


def balance(client: TestClient) -> str:
    return client.get("/wallet").json()["balance"]


def history(client: TestClient) -> list[dict]:
    return client.get("/wallet/transactions").json()


def total_of_all_wallets(db_session: Session) -> Decimal:
    """Money in minus money out, over every wallet including the outside world."""
    wallets = db_session.scalars(select(Wallet)).all()
    return sum((get_balance(db_session, wallet) for wallet in wallets), Decimal("0"))


# --- balance and top-up ---


def test_a_new_wallet_is_empty(client: TestClient):
    assert client.get("/wallet").json() == {"balance": "0.00", "currency": "CAD"}
    assert history(client) == []


def test_top_up_adds_money(client: TestClient):
    response = top_up(client, "50.00")

    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == "50.00"
    assert body["transaction"]["kind"] == "top_up"
    assert body["transaction"]["direction"] == "in"
    assert body["transaction"]["amount"] == "50.00"
    # A top-up has no other person.
    assert body["transaction"]["counterparty"] is None
    assert balance(client) == "50.00"


def test_top_ups_add_up(client: TestClient):
    top_up(client, "20.00")
    top_up(client, "0.01")

    assert balance(client) == "20.01"


@pytest.mark.parametrize("amount", ["0", "-5.00", "1.999", "10000.01", "abc"])
def test_a_bad_amount_is_rejected(client: TestClient, amount: str):
    assert top_up(client, amount).status_code == 422
    assert balance(client) == "0.00"


# --- sending ---


def test_sending_moves_money_from_one_wallet_to_the_other(
    client: TestClient, other_client: TestClient
):
    top_up(client, "100.00")

    response = send(client, ALEX, "30.00", note="  Pizza  ")

    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == "70.00"
    assert body["transaction"] == {
        "id": body["transaction"]["id"],
        "kind": "send",
        "direction": "out",
        "amount": "30.00",
        "counterparty": ALEX,
        "note": "Pizza",
        "created_at": body["transaction"]["created_at"],
    }
    assert balance(client) == "70.00"
    assert balance(other_client) == "30.00"


def test_each_side_sees_the_transfer_from_their_own_side(
    client: TestClient, other_client: TestClient
):
    top_up(client, "100.00")
    send(client, ALEX, "30.00", note="Pizza")

    sams, alexs = history(client), history(other_client)

    # Newest first: the send, then the top-up.
    assert [(item["kind"], item["direction"], item["counterparty"]) for item in sams] == [
        ("send", "out", ALEX),
        ("top_up", "in", None),
    ]
    assert [(item["kind"], item["direction"], item["counterparty"]) for item in alexs] == [
        ("send", "in", SAM)
    ]
    assert alexs[0]["note"] == "Pizza"


def test_you_cannot_send_more_than_you_have(client: TestClient, other_client: TestClient):
    top_up(client, "10.00")

    response = send(client, ALEX, "10.01")

    assert response.status_code == 409
    assert response.json()["detail"] == "You do not have enough money in your wallet."
    assert balance(client) == "10.00"
    assert balance(other_client) == "0.00"


def test_you_can_send_everything_you_have(client: TestClient, other_client: TestClient):
    top_up(client, "10.00")

    assert send(client, ALEX, "10.00").status_code == 200
    assert balance(client) == "0.00"


def test_an_empty_wallet_cannot_send(client: TestClient, other_client: TestClient):
    assert send(client, ALEX, "0.01").status_code == 409


def test_you_cannot_send_to_yourself(client: TestClient):
    top_up(client, "10.00")

    # Also when the email is typed in capitals.
    assert send(client, SAM.upper(), "5.00").status_code == 422
    assert balance(client) == "10.00"


def test_sending_to_an_unknown_email_gives_404(client: TestClient):
    top_up(client, "10.00")

    response = send(client, "nobody@example.com", "5.00")

    assert response.status_code == 404
    assert balance(client) == "10.00"


def test_the_recipient_email_is_not_case_sensitive(client: TestClient, other_client: TestClient):
    top_up(client, "10.00")

    assert send(client, "Alex@Example.com", "4.00").status_code == 200
    assert balance(other_client) == "4.00"


def test_money_received_can_be_sent_on(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")
    send(client, ALEX, "50.00")

    assert send(other_client, SAM, "20.00").status_code == 200
    assert (balance(client), balance(other_client)) == ("20.00", "30.00")


# --- the same request arriving twice ---


def test_a_repeated_top_up_adds_the_money_once(client: TestClient):
    same_key = key()

    first = top_up(client, "25.00", same_key)
    second = top_up(client, "25.00", same_key)

    assert second.status_code == 200
    assert second.json()["transaction"]["id"] == first.json()["transaction"]["id"]
    assert balance(client) == "25.00"
    assert len(history(client)) == 1


def test_a_repeated_send_moves_the_money_once(client: TestClient, other_client: TestClient):
    top_up(client, "100.00")
    payload = {"to_email": ALEX, "amount": "30.00", "idempotency_key": key()}

    first = client.post("/wallet/send", json=payload)
    second = client.post("/wallet/send", json=payload)  # a double tap

    assert second.status_code == 200
    assert second.json()["transaction"]["id"] == first.json()["transaction"]["id"]
    assert (balance(client), balance(other_client)) == ("70.00", "30.00")


def test_a_request_id_cannot_be_reused_for_a_different_transfer(
    client: TestClient, other_client: TestClient
):
    top_up(client, "100.00")
    same_key = key()
    client.post(
        "/wallet/send", json={"to_email": ALEX, "amount": "30.00", "idempotency_key": same_key}
    )

    different = client.post(
        "/wallet/send", json={"to_email": ALEX, "amount": "99.00", "idempotency_key": same_key}
    )

    assert different.status_code == 409
    assert (balance(client), balance(other_client)) == ("70.00", "30.00")


def test_a_request_id_is_required(client: TestClient):
    assert client.post("/wallet/top-up", json={"amount": "5.00"}).status_code == 422
    short = {"amount": "5.00", "idempotency_key": "abc"}
    assert client.post("/wallet/top-up", json=short).status_code == 422


# --- the ledger ---


def test_money_is_never_created_or_lost(
    client: TestClient, other_client: TestClient, db_session: Session
):
    top_up(client, "100.00")
    top_up(other_client, "40.50")
    send(client, ALEX, "33.33")
    send(other_client, SAM, "0.01")
    send(client, ALEX, "500.00")  # refused: not enough money

    # Every transfer takes from one wallet what it gives to another, so
    # everything added together is always exactly zero.
    assert total_of_all_wallets(db_session) == Decimal("0")
    # The outside world is down by exactly what was topped up.
    outside = db_session.scalars(select(Wallet).where(Wallet.user_id.is_(None))).one()
    assert get_balance(db_session, outside) == Decimal("-140.50")
    assert (balance(client), balance(other_client)) == ("66.68", "73.82")


def test_each_user_has_exactly_one_wallet(client: TestClient, db_session: Session):
    for _ in range(3):
        client.get("/wallet")
        top_up(client, "1.00")

    user_wallets = db_session.scalar(
        select(func.count()).select_from(Wallet).where(Wallet.user_id.is_not(None))
    )
    assert user_wallets == 1


def test_the_database_refuses_a_transfer_of_nothing_or_to_the_same_wallet(
    client: TestClient, db_session: Session
):
    client.get("/wallet")
    wallet = db_session.scalars(select(Wallet).where(Wallet.user_id.is_not(None))).one()
    outside = get_or_create_wallet(db_session, None)
    db_session.commit()

    for bad in (
        {"from_wallet_id": outside.id, "to_wallet_id": wallet.id, "amount": Decimal("0")},
        {"from_wallet_id": outside.id, "to_wallet_id": wallet.id, "amount": Decimal("-5")},
        {"from_wallet_id": wallet.id, "to_wallet_id": wallet.id, "amount": Decimal("5")},
    ):
        db_session.add(WalletTransfer(kind=TransferKind.SEND, idempotency_key=key(), **bad))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()


def test_move_money_refuses_an_overdraft_unless_allowed(client: TestClient, db_session: Session):
    client.get("/wallet")
    wallet = db_session.scalars(select(Wallet).where(Wallet.user_id.is_not(None))).one()
    outside = get_or_create_wallet(db_session, None)

    with pytest.raises(InsufficientFunds):
        move_money(
            db_session,
            kind=TransferKind.SEND,
            source=wallet,
            destination=outside,
            amount=Decimal("1.00"),
            idempotency_key=key(),
        )
    # Only the outside-world wallet may go below zero.
    move_money(
        db_session,
        kind=TransferKind.TOP_UP,
        source=outside,
        destination=wallet,
        amount=Decimal("1.00"),
        idempotency_key=key(),
        allow_overdraft=True,
    )
    assert get_balance(db_session, wallet) == Decimal("1.00")


# --- ownership ---


def test_a_wallet_and_its_history_belong_to_its_owner(client: TestClient, other_client: TestClient):
    top_up(client, "100.00")

    assert balance(other_client) == "0.00"
    assert history(other_client) == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/wallet"),
        ("POST", "/wallet/top-up"),
        ("POST", "/wallet/send"),
        ("GET", "/wallet/transactions"),
    ],
)
def test_every_wallet_endpoint_requires_a_login(
    anonymous_client: TestClient, method: str, path: str
):
    assert anonymous_client.request(method, path).status_code == 401
