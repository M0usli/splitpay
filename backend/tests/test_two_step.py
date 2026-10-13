"""Two-step login: a 6-digit code from an authenticator app, after the password.

The tests play the authenticator app themselves: they take the secret from
the set-up answer and work out the current code with `app.totp`.
"""

import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import totp
from app.models import TwoStepLogin

EMAIL = "two-step@example.com"
PASSWORD = "a-long-enough-password"


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def current_code(secret: str, steps_ahead: int = 0) -> str:
    return totp.code_for(secret, totp.step_at(now()) + steps_ahead)


def wrong_code(secret: str) -> str:
    """Six digits that are not valid now, a step ago or a step ahead."""
    valid = {current_code(secret, offset) for offset in (-1, 0, 1)}
    return next(code for code in ("000000", "111111", "222222", "333333") if code not in valid)


@pytest.fixture
def account(anonymous_client: TestClient) -> TestClient:
    """A client logged in to a real account, made through the register endpoint."""
    response = anonymous_client.post("/auth/register", json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 201
    return anonymous_client


def turn_on(client: TestClient) -> str:
    """Set up and enable two-step login. Returns the secret."""
    secret = client.post("/auth/two-step/setup").json()["secret"]
    # The previous step's code, so the tests can still use the current one afterwards.
    assert (
        client.post("/auth/two-step/enable", json={"code": current_code(secret, -1)}).status_code
        == 200
    )
    return secret


def log_in(client: TestClient, **extra):
    client.post("/auth/logout")
    return client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD, **extra})


# --- the algorithm ---


@pytest.mark.parametrize(
    ("seconds", "code"),
    [(59, "287082"), (1111111109, "081804"), (1234567890, "005924"), (2000000000, "279037")],
)
def test_the_codes_match_the_published_test_values(seconds: int, code: str):
    """The test values of RFC 6238, shortened to 6 digits. Their secret is this text."""
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # base32 of "12345678901234567890"
    moment = datetime.datetime.fromtimestamp(seconds, datetime.UTC)

    assert totp.code_for(secret, totp.step_at(moment)) == code


def test_a_code_is_good_for_its_own_step_and_one_either_side():
    secret = totp.new_secret()
    moment = datetime.datetime(2026, 10, 13, 12, 0, 0, tzinfo=datetime.UTC)
    step = totp.step_at(moment)

    for offset in (-1, 0, 1):
        assert (
            totp.matching_step(secret, totp.code_for(secret, step + offset), moment, None)
            == step + offset
        )
    assert totp.matching_step(secret, totp.code_for(secret, step + 2), moment, None) is None
    assert totp.matching_step(secret, totp.code_for(secret, step - 2), moment, None) is None


def test_a_used_step_and_anything_before_it_is_refused():
    secret = totp.new_secret()
    moment = datetime.datetime(2026, 10, 13, 12, 0, 0, tzinfo=datetime.UTC)
    step = totp.step_at(moment)

    assert totp.matching_step(secret, totp.code_for(secret, step), moment, step) is None
    assert totp.matching_step(secret, totp.code_for(secret, step - 1), moment, step) is None
    assert totp.matching_step(secret, totp.code_for(secret, step + 1), moment, step) == step + 1


def test_the_qr_address_is_in_the_format_authenticator_apps_read():
    uri = totp.provisioning_uri("ABCDEFGH", "sam@example.com")

    assert uri == (
        "otpauth://totp/SplitPay%3Asam%40example.com?secret=ABCDEFGH&issuer=SplitPay&digits=6&period=30"
    )


def test_every_secret_is_different():
    assert totp.new_secret() != totp.new_secret()
    assert len(totp.new_secret()) == 32


# --- turning it on and off ---


def test_it_is_off_for_a_new_account(account: TestClient):
    assert account.get("/auth/two-step").json() == {"is_enabled": False}
    # Logging in needs only the password.
    assert log_in(account).status_code == 200


def test_set_up_alone_does_not_turn_it_on(account: TestClient):
    setup = account.post("/auth/two-step/setup").json()

    assert setup["uri"].startswith("otpauth://totp/SplitPay%3Atwo-step%40example.com?secret=")
    assert setup["secret"] in setup["uri"]
    assert account.get("/auth/two-step").json() == {"is_enabled": False}
    assert log_in(account).status_code == 200


def test_the_first_code_proves_the_app_works_and_turns_it_on(account: TestClient):
    secret = account.post("/auth/two-step/setup").json()["secret"]

    wrong = account.post("/auth/two-step/enable", json={"code": wrong_code(secret)})
    right = account.post("/auth/two-step/enable", json={"code": current_code(secret)})

    assert wrong.status_code == 400
    assert right.json() == {"is_enabled": True}
    assert account.get("/auth/two-step").json() == {"is_enabled": True}


def test_starting_again_replaces_the_secret(account: TestClient):
    first = account.post("/auth/two-step/setup").json()["secret"]
    second = account.post("/auth/two-step/setup").json()["secret"]

    assert first != second
    assert (
        account.post("/auth/two-step/enable", json={"code": current_code(second)}).status_code
        == 200
    )


def test_it_cannot_be_set_up_again_while_on(account: TestClient):
    turn_on(account)

    assert account.post("/auth/two-step/setup").status_code == 409


def test_turning_it_off_needs_a_code(account: TestClient, db_session: Session):
    secret = turn_on(account)

    assert (
        account.post("/auth/two-step/disable", json={"code": wrong_code(secret)}).status_code == 400
    )
    assert account.get("/auth/two-step").json() == {"is_enabled": True}
    assert account.post("/auth/two-step/disable", json={"code": current_code(secret)}).json() == {
        "is_enabled": False
    }
    assert db_session.scalars(select(TwoStepLogin)).all() == []
    assert log_in(account).status_code == 200


@pytest.mark.parametrize("code", ["12345", "1234567", "abcdef", ""])
def test_a_code_must_be_six_digits(account: TestClient, code: str):
    account.post("/auth/two-step/setup")

    assert account.post("/auth/two-step/enable", json={"code": code}).status_code == 422


# --- logging in ---


def test_with_it_on_the_password_alone_is_not_enough(account: TestClient):
    turn_on(account)

    response = log_in(account)

    assert response.status_code == 403
    assert response.json()["detail"] == "Enter the 6-digit code from your authenticator app."
    assert account.get("/auth/me").status_code == 401


def test_the_right_code_logs_in(account: TestClient):
    secret = turn_on(account)

    response = log_in(account, code=current_code(secret))

    assert response.status_code == 200
    assert account.get("/auth/me").json()["email"] == EMAIL


def test_a_wrong_code_does_not_log_in(account: TestClient):
    secret = turn_on(account)

    response = log_in(account, code=wrong_code(secret))

    assert response.status_code == 403
    assert response.json()["detail"] == "That code is not right. Wait for a new one and try again."
    assert account.get("/auth/me").status_code == 401


def test_a_code_works_only_once(account: TestClient):
    secret = turn_on(account)
    code = current_code(secret)

    assert log_in(account, code=code).status_code == 200
    # Someone who watched the code being typed cannot use it again.
    assert log_in(account, code=code).status_code == 403


def test_a_wrong_password_is_refused_before_the_code_is_looked_at(account: TestClient):
    secret = turn_on(account)
    account.post("/auth/logout")

    response = account.post(
        "/auth/login",
        json={"email": EMAIL, "password": "not-the-password", "code": current_code(secret)},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Wrong email or password"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/auth/two-step"),
        ("POST", "/auth/two-step/setup"),
        ("POST", "/auth/two-step/enable"),
        ("POST", "/auth/two-step/disable"),
    ],
)
def test_the_two_step_endpoints_require_a_login(
    anonymous_client: TestClient, method: str, path: str
):
    assert anonymous_client.request(method, path).status_code == 401
