"""Tests for the evaluation script. OCR and the LLM are fakes, as everywhere else."""

import csv
import datetime
from decimal import Decimal
from pathlib import Path

import pytest

from app.config import Settings
from app.enums import Category
from app.eval import cli
from app.eval.labels import Label, LabelError, load_labels, write_label_template
from app.eval.report import format_summary, summarize, write_results_csv
from app.eval.runner import evaluate_receipt, run_evaluation
from app.eval.scoring import is_correct, merchant_similarity
from app.extraction import ExtractionError
from app.ocr import OcrError
from tests.conftest import GOOD_REPLY, FakeLlmClient, FakeOcrEngine
from tests.samples import encode, make_text_image

# What GOOD_REPLY in conftest.py says, as labels.
GOOD_LABELS = {
    "merchant": "Loblaws",
    "date": datetime.date(2026, 10, 5),
    "tax": Decimal("1.10"),
    "total": Decimal("9.58"),
    "category": Category.GROCERIES,
}

WRONG_TOTAL_REPLY = (
    '{"merchant": "LOBLAWS", "date": "2026-10-05", "subtotal": null, "tax": "1.10", '
    '"total": "9.50", "currency": null, "category": "Groceries"}'
)


@pytest.fixture
def eval_dir(tmp_path: Path) -> Path:
    """An evaluation folder holding two receipt images and no labels yet."""
    receipts_dir = tmp_path / "receipts"
    receipts_dir.mkdir()
    for name in ("a.png", "b.png"):
        (receipts_dir / name).write_bytes(encode(make_text_image(), ".png"))
    return tmp_path


def write_labels(eval_dir: Path, text: str) -> Path:
    path = eval_dir / "labels.csv"
    path.write_text(text, encoding="utf-8")
    return path


# --- scoring ---


def test_merchant_match_ignores_case_and_punctuation() -> None:
    assert merchant_similarity("FreshCo", "FRESHCO") == 1.0
    assert is_correct("merchant", "Shoppers Drug Mart", "SHOPPERS DRUG MART.")


def test_merchant_match_allows_small_differences() -> None:
    assert is_correct("merchant", "Tim Hortons", "Tim Hortons #2417")


def test_merchant_match_rejects_a_different_name() -> None:
    assert not is_correct("merchant", "Loblaws", "Walmart")


def test_amounts_and_dates_must_match_exactly() -> None:
    assert is_correct("total", Decimal("38.5"), Decimal("38.50"))
    assert not is_correct("total", Decimal("38.47"), Decimal("38.48"))
    assert not is_correct("date", datetime.date(2026, 10, 8), datetime.date(2026, 10, 9))


def test_a_missing_value_only_matches_a_missing_value() -> None:
    assert is_correct("tax", None, None)
    assert not is_correct("tax", None, Decimal("0.00"))
    assert not is_correct("tax", Decimal("1.62"), None)


# --- labels ---


def test_load_labels_parses_each_column(eval_dir: Path) -> None:
    path = write_labels(
        eval_dir,
        "filename,merchant,date,tax,total,category\na.png,Loblaws,2026-10-05,1.10,9.58,Groceries\n",
    )

    assert load_labels(path) == [Label(filename="a.png", expected=GOOD_LABELS)]


def test_empty_cell_is_not_scored_and_none_means_absent(eval_dir: Path) -> None:
    path = write_labels(
        eval_dir, "filename,merchant,date,tax,total,category\na.png,,2026-10-05,none,9.58,\n"
    )

    (label,) = load_labels(path)

    assert label.expected == {
        "date": datetime.date(2026, 10, 5),
        "tax": None,
        "total": Decimal("9.58"),
    }


def test_load_labels_accepts_a_file_saved_by_excel(eval_dir: Path) -> None:
    path = eval_dir / "labels.csv"
    # Excel starts CSV files with an invisible marker (a "BOM").
    path.write_text(
        "filename,merchant,date,tax,total\na.png,Loblaws,,,9.58\n", encoding="utf-8-sig"
    )

    assert load_labels(path)[0].expected == {"merchant": "Loblaws", "total": Decimal("9.58")}


@pytest.mark.parametrize(
    ("row", "problem"),
    [
        ("a.png,Loblaws,10/05/2026,1.10,9.58,Groceries", "date is '10/05/2026'"),
        ("a.png,Loblaws,2026-10-05,1.10,$9.58,Groceries", "total is '$9.58'"),
        ("a.png,Loblaws,2026-10-05,1.10,9.58,Food", "category is 'Food'"),
    ],
)
def test_load_labels_explains_a_bad_value(eval_dir: Path, row: str, problem: str) -> None:
    path = write_labels(eval_dir, f"filename,merchant,date,tax,total,category\n{row}\n")

    with pytest.raises(LabelError, match="row 2") as error:
        load_labels(path)

    assert problem in str(error.value)


def test_load_labels_reports_a_missing_file(eval_dir: Path) -> None:
    with pytest.raises(LabelError, match="does not exist"):
        load_labels(eval_dir / "labels.csv")


def test_write_label_template_lists_every_receipt(eval_dir: Path) -> None:
    (eval_dir / "receipts" / "notes.txt").write_text("not a receipt")
    path = eval_dir / "labels.csv"

    assert write_label_template(eval_dir / "receipts", path) == 2

    with path.open(newline="") as file:
        rows = list(csv.reader(file))
    assert rows[0] == ["filename", "merchant", "date", "tax", "total", "category"]
    assert [row[0] for row in rows[1:]] == ["a.png", "b.png"]


def test_write_label_template_never_replaces_existing_labels(eval_dir: Path) -> None:
    path = write_labels(eval_dir, "filename,total\na.png,9.58\n")

    with pytest.raises(LabelError, match="already exists"):
        write_label_template(eval_dir / "receipts", path)

    assert path.read_text() == "filename,total\na.png,9.58\n"


def test_write_label_template_needs_receipt_files(tmp_path: Path) -> None:
    with pytest.raises(LabelError, match="No receipt files"):
        write_label_template(tmp_path / "receipts", tmp_path / "labels.csv")

    assert not (tmp_path / "labels.csv").exists()


# --- running the pipeline ---


def test_evaluate_receipt_scores_a_correct_extraction(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    label = Label("a.png", GOOD_LABELS)

    result = evaluate_receipt(
        eval_dir / "receipts" / "a.png", label, fake_ocr, fake_llm, preprocess=True
    )

    assert result.error is None
    assert all(result.is_field_correct(field) for field in GOOD_LABELS)
    assert result.total_seconds > 0


def test_evaluate_receipt_marks_a_wrong_field(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    fake_llm.replies = [WRONG_TOTAL_REPLY]
    label = Label("a.png", {"merchant": "Loblaws", "total": Decimal("9.58")})

    result = evaluate_receipt(
        eval_dir / "receipts" / "a.png", label, fake_ocr, fake_llm, preprocess=True
    )

    assert result.is_field_correct("merchant") is True
    assert result.is_field_correct("total") is False
    # The date has no label, so it is neither right nor wrong.
    assert result.is_field_correct("date") is None


@pytest.mark.parametrize("preprocess", [True, False])
def test_evaluate_receipt_passes_the_preprocess_choice_to_ocr(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient, preprocess: bool
) -> None:
    evaluate_receipt(
        eval_dir / "receipts" / "a.png",
        Label("a.png", {}),
        fake_ocr,
        fake_llm,
        preprocess=preprocess,
    )

    # A preprocessed image is black and white (2 dimensions); the original has
    # a third dimension for its colour channels.
    assert fake_ocr.received_images[0].ndim == (2 if preprocess else 3)


def test_a_failure_counts_every_labelled_field_as_wrong(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    fake_ocr.error = OcrError("No text could be found in this file.")
    label = Label("a.png", {"total": Decimal("9.58"), "tax": None})

    result = evaluate_receipt(
        eval_dir / "receipts" / "a.png", label, fake_ocr, fake_llm, preprocess=True
    )

    assert result.error == "OCR failed: No text could be found in this file."
    assert result.is_field_correct("total") is False
    assert result.is_field_correct("tax") is False
    assert fake_llm.user_messages == []


def test_evaluate_receipt_records_an_extraction_failure(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    fake_llm.error = ExtractionError("Could not reach the AI service.")

    result = evaluate_receipt(
        eval_dir / "receipts" / "a.png",
        Label("a.png", GOOD_LABELS),
        fake_ocr,
        fake_llm,
        preprocess=True,
    )

    assert result.error == "Extraction failed: Could not reach the AI service."


def test_evaluate_receipt_reports_a_missing_file(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    result = evaluate_receipt(
        eval_dir / "receipts" / "gone.png",
        Label("gone.png", GOOD_LABELS),
        fake_ocr,
        fake_llm,
        preprocess=True,
    )

    assert result.error == "File not found in the receipts folder."
    assert fake_ocr.received_images == []


# --- summary and results file ---


def test_summary_counts_correct_fields_per_mode(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    labels = [
        Label("a.png", GOOD_LABELS),
        Label("b.png", GOOD_LABELS),
        Label("gone.png", GOOD_LABELS),
    ]
    # a.png is read correctly, b.png gets a wrong total, gone.png does not exist.
    fake_llm.replies = [GOOD_REPLY, WRONG_TOTAL_REPLY]

    results = run_evaluation(eval_dir / "receipts", labels, fake_ocr, fake_llm, modes=[True])
    summary = summarize(results, preprocess=True)

    assert summary.receipts == 3
    assert summary.failed == 1
    assert (summary.fields["merchant"].correct, summary.fields["merchant"].labelled) == (2, 3)
    assert (summary.fields["total"].correct, summary.fields["total"].labelled) == (1, 3)
    assert (summary.all_fields.correct, summary.all_fields.labelled) == (1, 3)
    assert summary.average_seconds is not None

    text = format_summary(results, [True])
    assert "b.png (with preprocessing): total should be 9.58, got 9.50" in text
    assert "gone.png (with preprocessing): File not found in the receipts folder." in text


def test_run_evaluation_runs_each_receipt_once_per_mode(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    labels = [Label("a.png", GOOD_LABELS), Label("b.png", GOOD_LABELS)]

    results = run_evaluation(eval_dir / "receipts", labels, fake_ocr, fake_llm, modes=[True, False])

    assert [(result.filename, result.preprocess) for result in results] == [
        ("a.png", True),
        ("a.png", False),
        ("b.png", True),
        ("b.png", False),
    ]
    assert summarize(results, preprocess=False).receipts == 2


def test_results_csv_has_one_row_per_run(
    eval_dir: Path, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    fake_llm.replies = [WRONG_TOTAL_REPLY]
    labels = [Label("a.png", {"merchant": "Loblaws", "total": Decimal("9.58"), "tax": None})]
    results = run_evaluation(eval_dir / "receipts", labels, fake_ocr, fake_llm, modes=[True, False])

    path = eval_dir / "results.csv"
    write_results_csv(results, path)

    with path.open(newline="") as file:
        rows = list(csv.DictReader(file))
    assert [row["mode"] for row in rows] == ["preprocessed", "raw"]
    first = rows[0]
    assert first["status"] == "ok"
    assert (first["merchant_expected"], first["merchant_predicted"]) == ("Loblaws", "LOBLAWS")
    assert (first["merchant_correct"], first["merchant_similarity"]) == ("yes", "1.00")
    assert (first["total_expected"], first["total_predicted"], first["total_correct"]) == (
        "9.58",
        "9.50",
        "no",
    )
    assert (first["tax_expected"], first["tax_predicted"], first["tax_correct"]) == (
        "null",
        "1.10",
        "no",
    )
    # The date was not labelled: the prediction is recorded but not scored.
    assert (first["date_expected"], first["date_predicted"], first["date_correct"]) == (
        "",
        "2026-10-05",
        "",
    )


# --- command line ---


@pytest.fixture
def fake_cli(
    monkeypatch: pytest.MonkeyPatch, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
) -> None:
    """Make the command line use the fakes and a pretend API key."""
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(anthropic_api_key="test-key"))
    monkeypatch.setattr(cli, "get_ocr_engine", lambda: fake_ocr)
    monkeypatch.setattr(cli, "get_llm_client", lambda settings: fake_llm)


@pytest.mark.usefixtures("fake_cli")
def test_cli_prints_a_summary_and_saves_results(
    eval_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_labels(
        eval_dir,
        "filename,merchant,date,tax,total,category\na.png,Loblaws,2026-10-05,1.10,9.58,Groceries\n",
    )

    exit_code = cli.main(["--dir", str(eval_dir)])

    output = capsys.readouterr().out
    assert exit_code == 0
    assert "with preprocessing" in output and "without preprocessing" in output
    assert "1/1  100.0%" in output
    assert "Skipping 1 file(s) with no row in labels.csv: b.png" in output
    assert (eval_dir / "results.csv").is_file()


@pytest.mark.usefixtures("fake_cli")
def test_cli_limit_and_single_mode(eval_dir: Path, fake_llm: FakeLlmClient) -> None:
    write_labels(eval_dir, "filename,total\na.png,9.58\nb.png,9.58\n")

    assert cli.main(["--dir", str(eval_dir), "--mode", "raw", "--limit", "1"]) == 0

    assert len(fake_llm.user_messages) == 1


@pytest.mark.usefixtures("fake_cli")
def test_cli_init_labels_creates_the_template(eval_dir: Path, fake_llm: FakeLlmClient) -> None:
    assert cli.main(["--dir", str(eval_dir), "--init-labels"]) == 0

    assert (eval_dir / "labels.csv").read_text().startswith("filename,merchant,date,tax,total")
    assert fake_llm.user_messages == []


@pytest.mark.usefixtures("fake_cli")
def test_cli_stops_on_a_bad_label_before_calling_the_llm(
    eval_dir: Path, fake_llm: FakeLlmClient, capsys: pytest.CaptureFixture[str]
) -> None:
    write_labels(eval_dir, "filename,date,total\na.png,Oct 5,9.58\n")

    assert cli.main(["--dir", str(eval_dir)]) == 1

    assert "row 2" in capsys.readouterr().out
    assert fake_llm.user_messages == []


def test_cli_needs_an_api_key(
    eval_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(anthropic_api_key=""))
    write_labels(eval_dir, "filename,total\na.png,9.58\n")

    assert cli.main(["--dir", str(eval_dir)]) == 1

    assert "ANTHROPIC_API_KEY is not set" in capsys.readouterr().out
