"""Running the pipeline on the test receipts and recording what happened."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.eval.labels import Label
from app.eval.scoring import is_correct
from app.extraction import ExtractionError, LlmClient
from app.extraction.extractor import extract_fields
from app.extraction.schemas import ExtractedFields
from app.ocr import OcrEngine, OcrError
from app.ocr.pipeline import extract_text


@dataclass
class ReceiptResult:
    """The outcome of one receipt in one mode (with or without preprocessing)."""

    filename: str
    preprocess: bool
    expected: dict[str, Any]
    predicted: ExtractedFields | None = None
    error: str | None = None
    ocr_seconds: float = 0.0
    llm_seconds: float = 0.0

    @property
    def total_seconds(self) -> float:
        return self.ocr_seconds + self.llm_seconds

    def predicted_value(self, field: str) -> Any:
        return getattr(self.predicted, field) if self.predicted is not None else None

    def is_field_correct(self, field: str) -> bool | None:
        """True or False for a labelled field, None for a field without a label.

        When the pipeline failed there is no prediction, so every labelled
        field counts as wrong. A failure must not make the numbers look better.
        """
        if field not in self.expected:
            return None
        if self.predicted is None:
            return False
        return is_correct(field, self.expected[field], self.predicted_value(field))


def evaluate_receipt(
    path: Path, label: Label, engine: OcrEngine, llm: LlmClient, *, preprocess: bool
) -> ReceiptResult:
    """Run OCR and extraction on one file: the same two steps as an upload."""
    result = ReceiptResult(filename=label.filename, preprocess=preprocess, expected=label.expected)
    if not path.is_file():
        result.error = "File not found in the receipts folder."
        return result

    # perf_counter is a clock made for measuring how long something takes.
    started = time.perf_counter()
    try:
        raw_text = extract_text(path, engine, preprocess=preprocess)
    except OcrError as error:
        result.error = f"OCR failed: {error}"
        return result
    finally:
        result.ocr_seconds = time.perf_counter() - started

    started = time.perf_counter()
    try:
        result.predicted = extract_fields(raw_text, llm)
    except ExtractionError as error:
        result.error = f"Extraction failed: {error}"
    finally:
        result.llm_seconds = time.perf_counter() - started
    return result


def run_evaluation(
    receipts_dir: Path,
    labels: list[Label],
    engine: OcrEngine,
    llm: LlmClient,
    *,
    modes: list[bool],
    on_result: Callable[[ReceiptResult], None] | None = None,
) -> list[ReceiptResult]:
    """Evaluate every labelled receipt once per mode (True = with preprocessing)."""
    results = []
    for label in labels:
        for preprocess in modes:
            result = evaluate_receipt(
                receipts_dir / label.filename, label, engine, llm, preprocess=preprocess
            )
            results.append(result)
            if on_result is not None:
                on_result(result)
    return results
