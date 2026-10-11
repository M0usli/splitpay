import datetime

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, hash_token
from app.models import User, UserSession

EMAIL = "sam@example.com"
PASSWORD = "correct horse battery"


def register(client: TestClient, email: str = EMAIL, password: str = PASSWORD):
    return client.post("/auth/register", json={"email": email, "password": password})


def login(client: TestClient, email: str = EMAIL, password: str = PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


# --- register ---


def test_register_creates_a_user_and_logs_in(client: TestClient):
    response = register(client)

    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["email"] == EMAIL
    # The test client keeps cookies like a browser, so /auth/me now works.
    assert client.get("/auth/me").json()["email"] == EMAIL


def test_register_never_returns_or_stores_the_password(client: TestClient, db_session: Session):
    response = register(client)

    assert "password" not in response.text
    user = db_session.scalar(select(User))
    assert user.password_hash != PASSWORD
    assert user.password_hash.startswith("$argon2")


def test_register_rejects_an_email_that_is_taken(client: TestClient):
    register(client)

    # Same address in different letter case is still the same account.
    response = register(client, email="SAM@example.com")

    assert response.status_code == 409


def test_register_rejects_bad_input(client: TestClient):
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, password="short").status_code == 422
    assert register(client, password="x" * 129).status_code == 422


# --- login ---


def test_login_with_the_right_password(client: TestClient):
    register(client)
    client.cookies.clear()

    response = login(client)

    assert response.status_code == 200
    assert response.json()["email"] == EMAIL
    assert client.get("/auth/me").status_code == 200


def test_login_fails_the_same_way_for_wrong_password_and_unknown_email(client: TestClient):
    register(client)
    client.cookies.clear()

    wrong_password = login(client, password="not the password")
    unknown_email = login(client, email="nobody@example.com")

    assert wrong_password.status_code == 401
    assert unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert client.get("/auth/me").status_code == 401


def test_session_cookie_is_http_only_and_holds_no_stored_value(
    client: TestClient, db_session: Session
):
    response = register(client)

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    # The database holds the hash of the token, not the token itself.
    token = response.cookies[SESSION_COOKIE]
    session = db_session.scalar(select(UserSession))
    assert session.token_hash == hash_token(token)
    assert session.token_hash != token


# --- me ---


def test_me_requires_a_session(client: TestClient):
    assert client.get("/auth/me").status_code == 401


def test_me_rejects_a_made_up_token(client: TestClient):
    client.cookies.set(SESSION_COOKIE, "made-up-token")

    assert client.get("/auth/me").status_code == 401


def test_me_rejects_an_expired_session(client: TestClient, db_session: Session):
    register(client)
    session = db_session.scalar(select(UserSession))
    session.expires_at = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=1)
    db_session.commit()

    assert client.get("/auth/me").status_code == 401


# --- logout ---


def test_logout_ends_the_session(client: TestClient, db_session: Session):
    token = register(client).cookies[SESSION_COOKIE]

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(UserSession)) is None
    # Even someone who copied the old token can no longer use it.
    client.cookies.set(SESSION_COOKIE, token)
    assert client.get("/auth/me").status_code == 401


def test_logout_without_a_session_is_fine(client: TestClient):
    assert client.post("/auth/logout").status_code == 204


def test_logging_in_twice_gives_two_separate_sessions(client: TestClient, db_session: Session):
    """Like a laptop and a phone: logging out on one leaves the other signed in."""
    first_token = register(client).cookies[SESSION_COOKIE]
    client.cookies.clear()
    login(client)

    client.post("/auth/logout")

    client.cookies.set(SESSION_COOKIE, first_token)
    assert client.get("/auth/me").status_code == 200
