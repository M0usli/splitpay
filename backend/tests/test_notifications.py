"""Notifications: a message for the other person whenever money or a request moves.

`client` is logged in as Sam and `other_client` as Alex.
"""

from fastapi.testclient import TestClient

from tests.test_household import ALEX, SAM, create_household
from tests.test_wallet import key, send, top_up


def inbox(client: TestClient) -> dict:
    return client.get("/notifications").json()


def messages(client: TestClient) -> list[str]:
    return [item["message"] for item in inbox(client)["items"]]


def test_a_new_user_has_no_notifications(client: TestClient):
    assert inbox(client) == {"unread_count": 0, "items": []}


def test_receiving_money_notifies_the_receiver_only(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")

    send(client, ALEX, "20.00", note="Pizza")

    assert messages(other_client) == [f"{SAM} sent you $20.00. For: Pizza"]
    assert inbox(other_client)["unread_count"] == 1
    # The sender did it themselves, and adding money needs no message either.
    assert messages(client) == []


def test_a_repeated_send_notifies_once(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")
    payload = {"to_email": ALEX, "amount": "20.00", "idempotency_key": key()}

    client.post("/wallet/send", json=payload)
    client.post("/wallet/send", json=payload)

    assert messages(other_client) == [f"{SAM} sent you $20.00."]


def test_a_refused_send_notifies_nobody(client: TestClient, other_client: TestClient):
    assert send(client, ALEX, "20.00").status_code == 409

    assert messages(other_client) == []


def test_a_request_and_each_answer_notify_the_other_side(
    client: TestClient, other_client: TestClient
):
    top_up(other_client, "50.00")
    paid = client.post("/wallet/requests", json={"to_email": ALEX, "amount": "12.00"}).json()
    declined = client.post("/wallet/requests", json={"to_email": ALEX, "amount": "7.00"}).json()
    cancelled = client.post("/wallet/requests", json={"to_email": ALEX, "amount": "3.00"}).json()

    other_client.post(f"/wallet/requests/{paid['id']}/pay", json={"idempotency_key": key()})
    other_client.post(f"/wallet/requests/{declined['id']}/decline")
    client.post(f"/wallet/requests/{cancelled['id']}/cancel")

    # Newest first. Alex was asked three times and saw one request taken back.
    assert messages(other_client) == [
        f"{SAM} cancelled their request for $3.00.",
        f"{SAM} asked you for $3.00.",
        f"{SAM} asked you for $7.00.",
        f"{SAM} asked you for $12.00.",
    ]
    assert messages(client) == [
        f"{ALEX} declined your request for $7.00.",
        f"{ALEX} paid your request for $12.00.",
    ]


def test_paying_a_request_twice_notifies_once(client: TestClient, other_client: TestClient):
    top_up(other_client, "50.00")
    request = client.post("/wallet/requests", json={"to_email": ALEX, "amount": "12.00"}).json()

    for _ in range(2):
        other_client.post(f"/wallet/requests/{request['id']}/pay", json={"idempotency_key": key()})

    assert messages(client) == [f"{ALEX} paid your request for $12.00."]


def test_a_split_bill_payment_notifies_the_person_paid(
    client: TestClient, other_client: TestClient
):
    top_up(client, "50.00")
    household = create_household(client)
    joined = other_client.post(
        "/household/join", json={"invite_code": household["invite_code"]}
    ).json()
    alex_id = next(member["id"] for member in joined["members"] if member["email"] == ALEX)
    payload = {"to_user_id": alex_id, "amount": "13.18", "idempotency_key": key()}

    client.post("/household/pay", json=payload)
    client.post("/household/pay", json=payload)  # a double tap

    assert messages(other_client) == [f"{SAM} paid you $13.18 for a split bill."]


def test_reading_marks_everything_read(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")
    send(client, ALEX, "5.00")
    send(client, ALEX, "6.00")
    assert inbox(other_client)["unread_count"] == 2

    assert other_client.post("/notifications/read").status_code == 204

    after = inbox(other_client)
    assert after["unread_count"] == 0
    assert [item["is_read"] for item in after["items"]] == [True, True]
    # A later message is unread again.
    send(client, ALEX, "7.00")
    assert inbox(other_client)["unread_count"] == 1


def test_marking_read_only_touches_your_own(client: TestClient, other_client: TestClient):
    top_up(client, "50.00")
    top_up(other_client, "50.00")
    send(client, ALEX, "5.00")
    send(other_client, SAM, "5.00")

    client.post("/notifications/read")

    assert inbox(client)["unread_count"] == 0
    assert inbox(other_client)["unread_count"] == 1


def test_the_notification_endpoints_require_a_login(anonymous_client: TestClient):
    assert anonymous_client.get("/notifications").status_code == 401
    assert anonymous_client.post("/notifications/read").status_code == 401
