from fastapi.testclient import TestClient

from app.main import app
from app.routers import health

client = TestClient(app)


def test_health_reports_database_ok(monkeypatch):
    monkeypatch.setattr(health, "check_database", lambda: True)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_database_unavailable(monkeypatch):
    monkeypatch.setattr(health, "check_database", lambda: False)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "unavailable"}
