"""The command line for the evaluation: `python -m app.eval`."""

import argparse
from pathlib import Path

from app.config import get_settings
from app.eval.labels import LabelError, find_receipt_files, load_labels, write_label_template
from app.eval.report import MODE_NAMES, format_summary, write_results_csv
from app.eval.runner import ReceiptResult, run_evaluation
from app.extraction import get_llm_client
from app.ocr import get_ocr_engine

# Which modes each --mode choice runs. True means "with preprocessing".
MODES = {"both": [True, False], "preprocessed": [True], "raw": [False]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.eval",
        description="Run the receipt pipeline on labelled test receipts and report its accuracy.",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=get_settings().eval_dir,
        help="folder holding receipts/ and labels.csv (default: %(default)s)",
    )
    parser.add_argument(
        "--mode",
        choices=list(MODES),
        default="both",
        help="run with image preprocessing, without it, or both to compare (default: both)",
    )
    parser.add_argument("--limit", type=int, help="only run the first N labelled receipts")
    parser.add_argument(
        "--init-labels",
        action="store_true",
        help="create labels.csv with one empty row per receipt file, then stop",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the evaluation. Returns the exit code: 0 for success, 1 for a problem."""
    args = build_parser().parse_args(argv)
    settings = get_settings()
    receipts_dir: Path = args.dir / "receipts"
    labels_path: Path = args.dir / "labels.csv"

    if args.init_labels:
        try:
            count = write_label_template(receipts_dir, labels_path)
        except LabelError as error:
            print(f"Error: {error}")
            return 1
        print(
            f"Wrote {labels_path} with {count} rows. Fill in the correct answers, then run again."
        )
        return 0

    try:
        labels = load_labels(labels_path)
    except LabelError as error:
        print(f"Error: {error}")
        return 1
    if args.limit is not None:
        labels = labels[: args.limit]
    if not labels:
        print(f"Error: {labels_path} has no labelled receipts.")
        return 1

    # Every receipt costs a paid API call, so check the key before starting.
    if not settings.anthropic_api_key:
        print("Error: ANTHROPIC_API_KEY is not set. Add it to the .env file.")
        return 1

    labelled_names = {label.filename for label in labels}
    unlabelled = [
        path.name for path in find_receipt_files(receipts_dir) if path.name not in labelled_names
    ]
    if unlabelled and args.limit is None:
        print(
            f"Skipping {len(unlabelled)} file(s) with no row in labels.csv: {', '.join(unlabelled)}"
        )

    modes = MODES[args.mode]
    total_runs = len(labels) * len(modes)
    print(f"Model: {settings.anthropic_model}")
    print(f"Evaluating {len(labels)} receipt(s), {total_runs} run(s) in total.\n")

    finished_runs = 0

    def print_progress(result: ReceiptResult) -> None:
        nonlocal finished_runs
        finished_runs += 1
        outcome = "FAILED" if result.error else "ok"
        print(
            f"[{finished_runs}/{total_runs}] {result.filename} ({MODE_NAMES[result.preprocess]}): "
            f"{outcome}, {result.total_seconds:.1f} s"
        )

    results = run_evaluation(
        receipts_dir,
        labels,
        get_ocr_engine(),
        get_llm_client(settings),
        modes=modes,
        on_result=print_progress,
    )

    results_path = args.dir / "results.csv"
    write_results_csv(results, results_path)
    print("\n" + format_summary(results, modes))
    print(f"\nDetails saved to {results_path}")
    return 0
