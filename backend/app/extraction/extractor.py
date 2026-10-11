"""Turn raw OCR text into validated fields, using an LLM."""

from pydantic import ValidationError

from app.extraction.base import ExtractionError, LlmClient
from app.extraction.prompts import SYSTEM_PROMPT, build_retry_message, build_user_message
from app.extraction.schemas import ExtractedFields

MAX_ATTEMPTS = 2  # the first try, plus one retry


def extract_fields(raw_text: str, llm: LlmClient) -> ExtractedFields:
    """Ask the model for the receipt's fields and validate its reply.

    If the reply does not pass validation, ask once more, telling the model
    what was wrong. If the second reply also fails, raise ExtractionError.
    """
    user_message = build_user_message(raw_text)

    for _attempt in range(MAX_ATTEMPTS):
        reply = llm.complete_json(SYSTEM_PROMPT, user_message, ExtractedFields)
        try:
            return ExtractedFields.model_validate_json(reply)
        except ValidationError as error:
            problem = "; ".join(
                f"{'.'.join(str(part) for part in issue['loc']) or 'reply'}: {issue['msg']}"
                for issue in error.errors()
            )
            user_message = build_retry_message(raw_text, problem)

    raise ExtractionError(
        f"The AI reply did not match the expected format after {MAX_ATTEMPTS} attempts."
    )
