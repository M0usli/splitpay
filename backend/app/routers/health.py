from fastapi import APIRouter

from app.database import check_database
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report whether the API is up and whether it can reach the database."""
    database = "ok" if check_database() else "unavailable"
    return HealthResponse(status="ok", database=database)
