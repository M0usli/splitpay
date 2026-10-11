"""Reading labels.csv: the correct answers for each test receipt."""

import csv
import datetime
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from app.enums import Category

# The fields that are scored, in the order they are reported.
FIELDS = ["merchant", "date", "tax", "total", "category"]
LABEL_COLUMNS = ["filename", *FIELDS]

# Written in a cell to say "this is not printed on the receipt", so the
# correct answer from the pipeline is null. An empty cell means "not labelled".
ABSENT = "NONE"

RECEIPT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}


class LabelError(Exception):
    """labels.csv is missing or has a value that cannot be understood."""


@dataclass(frozen=True)
class Label:
    """The correct answers for one receipt.

    `expected` only holds the fields that were labelled. A value of None
    means the receipt does not show that field at all.
    """

    filename: str
    expected: dict[str, Any]


def load_labels(path: Path) -> list[Label]:
    if not path.is_file():
        raise LabelError(f"{path} does not exist. Create it with --init-labels.")

    # "utf-8-sig" also accepts the invisible marker Excel puts at the start of a file.
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        missing = [
            column for column in ("filename", "total") if column not in (reader.fieldnames or [])
        ]
        if missing:
            raise LabelError(f"{path.name} needs a header row with these columns: {LABEL_COLUMNS}")

        labels = []
        # Row 1 is the header, so the first data row is row 2.
        for row_number, row in enumerate(reader, start=2):
            filename = (row.get("filename") or "").strip()
            if not filename:
                continue
            expected = {}
            for field in FIELDS:
                cell = (row.get(field) or "").strip()
                if not cell:
                    continue
                try:
                    expected[field] = None if cell.upper() == ABSENT else _parse_cell(field, cell)
                except (ValueError, InvalidOperation) as error:
                    raise LabelError(
                        f"{path.name} row {row_number} ({filename}): "
                        f"{field} is {cell!r}, expected {_FORMAT_HINTS[field]}."
                    ) from error
            labels.append(Label(filename=filename, expected=expected))
    return labels


_FORMAT_HINTS = {
    "merchant": "a name",
    "date": "a date written as YYYY-MM-DD",
    "tax": "an amount like 1.62",
    "total": "an amount like 38.47",
    "category": "one of: " + ", ".join(category.value for category in Category),
}


def _parse_cell(field: str, cell: str) -> Any:
    if field == "date":
        return datetime.date.fromisoformat(cell)
    if field in ("tax", "total"):
        return Decimal(cell)
    if field == "category":
        return Category(cell)
    return cell


def find_receipt_files(receipts_dir: Path) -> list[Path]:
    """The receipt images and PDFs in a folder, in name order."""
    if not receipts_dir.is_dir():
        return []
    return sorted(
        path for path in receipts_dir.iterdir() if path.suffix.lower() in RECEIPT_EXTENSIONS
    )


def write_label_template(receipts_dir: Path, labels_path: Path) -> int:
    """Create labels.csv with one empty row per receipt file. Returns the row count.

    Refuses to replace an existing file, so typed-in labels are never lost.
    """
    if labels_path.exists():
        raise LabelError(f"{labels_path} already exists; it was left unchanged.")
    files = find_receipt_files(receipts_dir)
    if not files:
        raise LabelError(f"No receipt files (JPG, PNG or PDF) found in {receipts_dir}.")
    with labels_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(LABEL_COLUMNS)
        for path in files:
            writer.writerow([path.name] + [""] * len(FIELDS))
    return len(files)
