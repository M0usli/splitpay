"""Turning the results into a CSV file and a printed summary."""

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.eval.labels import FIELDS
from app.eval.runner import ReceiptResult
from app.eval.scoring import merchant_similarity

MODE_NAMES = {True: "with preprocessing", False: "without preprocessing"}


@dataclass
class Score:
    """How many were right, out of how many were labelled."""

    correct: int = 0
    labelled: int = 0

    def __str__(self) -> str:
        if self.labelled == 0:
            return "not labelled"
        return f"{self.correct}/{self.labelled}  {self.correct / self.labelled:6.1%}"


@dataclass
class ModeSummary:
    preprocess: bool
    receipts: int
    failed: int
    fields: dict[str, Score]
    # Receipts where every labelled field was right.
    all_fields: Score
    # Averages over the receipts the pipeline finished. None if there were none.
    average_seconds: float | None
    average_ocr_seconds: float | None
    average_llm_seconds: float | None


def summarize(results: list[ReceiptResult], *, preprocess: bool) -> ModeSummary:
    """Add up the results of one mode."""
    results = [result for result in results if result.preprocess == preprocess]
    fields = {field: Score() for field in FIELDS}
    all_fields = Score()

    for result in results:
        outcomes = [result.is_field_correct(field) for field in FIELDS]
        for field, outcome in zip(FIELDS, outcomes, strict=True):
            if outcome is not None:
                fields[field].labelled += 1
                fields[field].correct += outcome
        labelled_outcomes = [outcome for outcome in outcomes if outcome is not None]
        if labelled_outcomes:
            all_fields.labelled += 1
            all_fields.correct += all(labelled_outcomes)

    finished = [result for result in results if result.error is None]

    def average(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    return ModeSummary(
        preprocess=preprocess,
        receipts=len(results),
        failed=len(results) - len(finished),
        fields=fields,
        all_fields=all_fields,
        average_seconds=average([result.total_seconds for result in finished]),
        average_ocr_seconds=average([result.ocr_seconds for result in finished]),
        average_llm_seconds=average([result.llm_seconds for result in finished]),
    )


def format_summary(results: list[ReceiptResult], modes: list[bool]) -> str:
    """The text printed at the end of a run: a table, then every failure and mistake."""
    summaries = [summarize(results, preprocess=mode) for mode in modes]

    def seconds(value: float | None) -> str:
        return "-" if value is None else f"{value:.2f} s"

    rows = [
        ["", *(MODE_NAMES[summary.preprocess] for summary in summaries)],
        ["Receipts", *(str(summary.receipts) for summary in summaries)],
        ["Pipeline failures", *(str(summary.failed) for summary in summaries)],
        *([field, *(str(summary.fields[field]) for summary in summaries)] for field in FIELDS),
        ["all fields correct", *(str(summary.all_fields) for summary in summaries)],
        ["Average time", *(seconds(summary.average_seconds) for summary in summaries)],
        ["  OCR", *(seconds(summary.average_ocr_seconds) for summary in summaries)],
        ["  LLM", *(seconds(summary.average_llm_seconds) for summary in summaries)],
    ]
    widths = [max(len(row[column]) for row in rows) for column in range(len(rows[0]))]
    lines = [
        "   ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip()
        for row in rows
    ]
    lines.insert(1, "   ".join("-" * width for width in widths))

    failures = [result for result in results if result.error is not None]
    lines += ["", f"Pipeline failures: {len(failures)}"]
    lines += [
        f"  {result.filename} ({MODE_NAMES[result.preprocess]}): {result.error}"
        for result in failures
    ]

    mistakes = [
        f"  {result.filename} ({MODE_NAMES[result.preprocess]}): {field} should be "
        f"{_show(result.expected[field])}, got {_show(result.predicted_value(field))}"
        for result in results
        if result.error is None
        for field in FIELDS
        if result.is_field_correct(field) is False
    ]
    lines += ["", f"Wrong answers: {len(mistakes)}", *mistakes]
    return "\n".join(lines)


def write_results_csv(results: list[ReceiptResult], path: Path) -> None:
    """Save one row per receipt and mode, with every expected and predicted value."""
    columns = ["filename", "mode", "status", "error"]
    for field in FIELDS:
        columns += [f"{field}_expected", f"{field}_predicted", f"{field}_correct"]
    columns += ["merchant_similarity", "ocr_seconds", "llm_seconds", "total_seconds"]

    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        for result in results:
            row = {
                "filename": result.filename,
                "mode": "preprocessed" if result.preprocess else "raw",
                "status": "failed" if result.error else "ok",
                "error": result.error or "",
                "ocr_seconds": f"{result.ocr_seconds:.3f}",
                "llm_seconds": f"{result.llm_seconds:.3f}",
                "total_seconds": f"{result.total_seconds:.3f}",
            }
            for field in FIELDS:
                correct = result.is_field_correct(field)
                row[f"{field}_expected"] = (
                    _show(result.expected[field]) if correct is not None else ""
                )
                row[f"{field}_predicted"] = (
                    _show(result.predicted_value(field)) if result.predicted else ""
                )
                row[f"{field}_correct"] = "" if correct is None else ("yes" if correct else "no")

            expected_merchant = result.expected.get("merchant")
            predicted_merchant = result.predicted_value("merchant")
            if expected_merchant and predicted_merchant:
                similarity = merchant_similarity(expected_merchant, predicted_merchant)
                row["merchant_similarity"] = f"{similarity:.2f}"
            writer.writerow(row)


def _show(value: Any) -> str:
    """A value as text. None is shown as "null", the word the API uses for "not found"."""
    return "null" if value is None else str(value)
