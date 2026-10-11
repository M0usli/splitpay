import anthropic
from pydantic import BaseModel

from app.extraction.base import ExtractionError

MAX_OUTPUT_TOKENS = 4096
REQUEST_TIMEOUT_SECONDS = 60.0


class ClaudeClient:
    """Calls Claude through the Anthropic SDK."""

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model

    def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        if not self._api_key:
            raise ExtractionError("ANTHROPIC_API_KEY is not set. Add it to the .env file.")

        # The SDK retries rate limits, server errors and network errors by
        # itself (2 retries with a growing delay), so we don't repeat that.
        client = anthropic.Anthropic(api_key=self._api_key, timeout=REQUEST_TIMEOUT_SECONDS)
        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    # Reading a receipt is a simple task, so ask for a quick answer.
                    "effort": "low",
                    # Structured output: the reply must be JSON matching this schema.
                    "format": {
                        "type": "json_schema",
                        "schema": anthropic.transform_schema(schema),
                    },
                },
            )
        except anthropic.AuthenticationError as error:
            raise ExtractionError(
                "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the .env file."
            ) from error
        except anthropic.RateLimitError as error:
            raise ExtractionError(
                "The AI service is rate limited right now. Try again in a minute."
            ) from error
        except anthropic.APIStatusError as error:
            raise ExtractionError(
                f"The AI service returned an error (status {error.status_code})."
            ) from error
        except anthropic.APIConnectionError as error:
            raise ExtractionError("Could not reach the AI service.") from error

        if response.stop_reason == "refusal":
            raise ExtractionError("The AI model declined to process this receipt.")
        if response.stop_reason == "max_tokens":
            raise ExtractionError("The AI model's reply was cut off before it finished.")

        for block in response.content:
            if block.type == "text":
                return block.text
        raise ExtractionError("The AI model returned an empty reply.")
