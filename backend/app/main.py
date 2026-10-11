"""Entry point: creates the FastAPI app and connects its parts."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_error_handlers
from app.routers import expenses, health, receipts, stats

settings = get_settings()

app = FastAPI(title=settings.app_name)

# The frontend (localhost:3000) and the backend (localhost:8000) are different
# origins, so the browser blocks requests between them unless the backend
# explicitly allows the frontend's origin. This is CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health.router)
app.include_router(expenses.router)
app.include_router(receipts.router)
app.include_router(stats.router)
