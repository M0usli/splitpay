"""The full OCR step: file on disk in, raw text out."""

from pathlib import Path

from app.ocr.base import OcrEngine, OcrError
from app.ocr.loading import load_pages
from app.ocr.preprocessing import preprocess_image


def extract_text(path: Path, engine: OcrEngine, *, preprocess: bool = True) -> str:
    """Read all the text from a receipt file.

    `preprocess=False` skips the image clean-up. It exists so the evaluation
    script can measure how much the clean-up actually helps.
    """
    page_texts = []
    for page in load_pages(path):
        image = preprocess_image(page) if preprocess else page
        text = engine.image_to_text(image).strip()
        if text:
            page_texts.append(text)

    if not page_texts:
        raise OcrError("No text could be found in this file.")
    return "\n\n".join(page_texts)
