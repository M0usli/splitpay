"""Application settings, read from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Each field is filled from the environment variable with the same name.

    For example, DATABASE_URL sets `database_url`. The values below are
    defaults for running the backend outside Docker.
    """

    app_name: str = "Receipt Tracker API"
    database_url: str = "postgresql+psycopg://receipts:receipts@localhost:5432/receipts"
    frontend_origin: str = "http://localhost:3000"

    # Where uploaded receipt files are stored on disk.
    upload_dir: Path = Path("uploads")
    max_upload_bytes: int = 10 * 1024 * 1024  # 10 MB

    # The evaluation set: a receipts/ folder and a labels.csv file.
    eval_dir: Path = Path("../eval")

    # Login sessions: how long one lasts, and whether the browser may send the
    # session cookie only over HTTPS. Local development uses plain HTTP, so
    # this is off here and must be turned on wherever the app is hosted.
    session_days: int = 30
    cookie_secure: bool = False

    # LLM extraction. The key comes from the environment and is never hardcoded.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"


@lru_cache
def get_settings() -> Settings:
    """Return the settings, creating them only once."""
    return Settings()


# Endpoints declare a parameter of this type to receive the settings.
SettingsDep = Annotated[Settings, Depends(get_settings)]
