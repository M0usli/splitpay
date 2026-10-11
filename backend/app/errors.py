"""Handlers that turn unexpected failures into clear JSON error responses."""

import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)


def handle_database_unavailable(request: Request, error: OperationalError) -> JSONResponse:
    """The database could not be reached (stopped, restarting, or wrong address).

    Without this handler the client would get a bare "Internal Server Error".
    503 means "service unavailable": the request was fine, try again later.
    """
    logger.error("Database unavailable during %s %s: %s", request.method, request.url.path, error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "The database is not available right now. Try again in a moment."},
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(OperationalError, handle_database_unavailable)
