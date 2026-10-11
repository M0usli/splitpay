"""LLM extraction: turning raw receipt text into structured fields."""

from typing import Annotated

from fastapi import Depends

from app.config import SettingsDep
from app.extraction.base import ExtractionError, LlmClient
from app.extraction.claude import ClaudeClient

__all__ = ["ExtractionError", "LlmClient", "LlmClientDep", "get_llm_client"]


def get_llm_client(settings: SettingsDep) -> LlmClient:
    """Choose the LLM client. Tests override this with a fake."""
    return ClaudeClient(api_key=settings.anthropic_api_key, model=settings.anthropic_model)


LlmClientDep = Annotated[LlmClient, Depends(get_llm_client)]
