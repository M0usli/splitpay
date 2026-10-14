"""Locking the app down for a public deployment: who may sign up, how often
log-ins may be tried, and how many receipts one user may scan a day.
"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.rate_limit import RateLimiter
from tests.test_receipts import PNG, upload

PASSWORD = "a-long-enough-password"


def register(client: TestClient, email: str = "new@example.com", **extra):
    return client.post("/auth/register", json={"email": email, "password": PASSWORD, **extra})


# --- who may sign up ---


def test_sign_up_is_open_by_default_for_local_development(anonymous_client: TestClient):
    assert anonymous_client.get("/auth/signup").json() == {"mode": "open"}
    assert register(anonymous_client).status_code == 201


def test_closed_sign_up_refuses_everyone(anonymous_client: TestClient, test_settings: Settings):
    test_settings.signup_mode = "closed"

    response = register(anonymous_client)

    assert response.status_code == 403
    assert response.json()["detail"] == "Sign-up is closed."
    assert anonymous_client.get("/auth/signup").json() == {"mode": "closed"}


def test_invite_only_sign_up_needs_the_right_code(
    anonymous_client: TestClient, test_settings: Settings
):
    test_settings.signup_mode = "invite"
    test_settings.signup_invite_code = "FLAT-2026"

    assert anonymous_client.get("/auth/signup").json() == {"mode": "invite"}
    assert register(anonymous_client).status_code == 403
    wrong = register(anonymous_client, invite_code="FLAT-2025")
    assert wrong.json()["detail"] == "That invite code is not right."
    assert register(anonymous_client, invite_code=" FLAT-2026 ").status_code == 201


def test_invite_mode_without_a_code_counts_as_closed(
    anonymous_client: TestClient, test_settings: Settings
):
    test_settings.signup_mode = "invite"
    test_settings.signup_invite_code = ""

    assert anonymous_client.get("/auth/signup").json() == {"mode": "closed"}
    assert register(anonymous_client, invite_code="").status_code == 403


def test_closing_sign_up_does_not_stop_existing_users_logging_in(
    anonymous_client: TestClient, test_settings: Settings
):
    register(anonymous_client)
    anonymous_client.post("/auth/logout")
    test_settings.signup_mode = "closed"

    response = anonymous_client.post(
        "/auth/login", json={"email": "new@example.com", "password": PASSWORD}
    )

    assert response.status_code == 200


# --- rate limits ---


def test_the_limiter_counts_within_the_window_only():
    limiter = RateLimiter()

    assert [limiter.hit("k", limit=2, window_seconds=60) for _ in range(2)] == [None, None]
    wait = limiter.hit("k", limit=2, window_seconds=60)
    assert wait is not None and 1 <= wait <= 60
    # Another key has its own count.
    assert limiter.hit("other", limit=2, window_seconds=60) is None
    # With a zero-length window nothing is remembered.
    assert limiter.hit("short", limit=1, window_seconds=0) is None
    assert limiter.hit("short", limit=1, window_seconds=0) is None


def test_log_in_is_limited_to_10_tries_in_10_minutes(anonymous_client: TestClient):
    wrong = {"email": "nobody@example.com", "password": "not-the-password"}

    answers = [anonymous_client.post("/auth/login", json=wrong).status_code for _ in range(11)]

    assert answers[:10] == [401] * 10
    assert answers[10] == 429
    refused = anonymous_client.post("/auth/login", json=wrong)
    assert refused.json()["detail"].startswith("Too many attempts. Try again in")
    assert int(refused.headers["Retry-After"]) > 0


def test_sign_up_is_limited_too(anonymous_client: TestClient):
    answers = [register(anonymous_client, f"user{n}@example.com").status_code for n in range(11)]

    assert answers[-1] == 429
    assert answers.count(201) == 10


# --- scans per day ---


def test_one_user_may_only_scan_so_many_receipts_a_day(client: TestClient, test_settings: Settings):
    test_settings.daily_scan_limit = 2

    first, second, third = (upload(client, PNG) for _ in range(3))

    assert (first.status_code, second.status_code) == (201, 201)
    assert third.status_code == 429
    assert third.json()["detail"].startswith("You can scan 2 receipts a day.")


def test_the_scan_limit_is_per_user(
    client: TestClient, other_client: TestClient, test_settings: Settings
):
    test_settings.daily_scan_limit = 1
    upload(client, PNG)

    assert upload(other_client, PNG).status_code == 201


def test_running_the_ai_again_is_limited_to_10_an_hour(client: TestClient):
    receipt = upload(client, PNG).json()

    answers = [client.post(f"/receipts/{receipt['id']}/extract").status_code for _ in range(11)]

    assert 429 not in answers[:10]
    assert answers[10] == 429
