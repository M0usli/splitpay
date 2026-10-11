"""The interface an LLM client has to follow."""

from typing import Protocol

from pydantic import BaseModel


class ExtractionError(Exception):
    """Extracting fields from a receipt failed. The message is safe to show to the user."""


class LlmClient(Protocol):
    """Anything that can answer a prompt with JSON text.

    Like OcrEngine, this is a Protocol so the real Claude client can be
    replaced by a fake in tests, or by another provider later.
    """

    def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        """Send a prompt and return the model's reply: JSON text shaped like `schema`."""
        ...
