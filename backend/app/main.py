"""Entry point: creates the FastAPI app and connects its parts."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_error_handlers
from app.routers import (
    auth,
    bank,
    bills,
    expenses,
    health,
    household,
    identity,
    money_requests,
    notifications,
    pin,
    receipts,
    recurring,
    stats,
    two_step,
    wallet,
)

settings = get_settings()

app = FastAPI(title=settings.app_name)

# The frontend (localhost:3000) and the backend (localhost:8000) are different
# origins, so the browser blocks requests between them unless the backend
# explicitly allows the frontend's origin. This is CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    # Lets the browser send the session cookie on requests from the frontend,
    # and lets the frontend's code read the answers to them.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(two_step.router)
app.include_router(expenses.router)
app.include_router(receipts.router)
app.include_router(stats.router)
app.include_router(household.router)
app.include_router(recurring.router)
app.include_router(bank.router)
app.include_router(wallet.router)
app.include_router(money_requests.router)
app.include_router(pin.router)
app.include_router(notifications.router)
app.include_router(bills.router)
app.include_router(identity.router)
