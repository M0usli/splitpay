"""Turn an uploaded file (JPG, PNG or PDF) into images OpenCV can work with."""

from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium

from app.ocr.base import OcrError

MAX_PDF_PAGES = 3
PDF_RENDER_SCALE = 300 / 72  # PDFs measure in 72 points per inch; render at 300 DPI


def load_pages(path: Path) -> list[np.ndarray]:
    """Return one colour image per page. A photo is a single page."""
    if path.suffix.lower() == ".pdf":
        return _load_pdf_pages(path)
    return [_load_image(path)]


def encode_png(image: np.ndarray) -> bytes:
    """Encode an image as PNG bytes, ready to send in an HTTP response."""
    succeeded, buffer = cv2.imencode(".png", image)
    if not succeeded:
        raise OcrError("Could not encode the image.")
    return buffer.tobytes()


def _load_image(path: Path) -> np.ndarray:
    # imdecode also applies the photo's orientation tag, so a phone picture
    # taken sideways comes out upright.
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise OcrError("The file could not be read as an image.")
    return image


def _load_pdf_pages(path: Path) -> list[np.ndarray]:
    try:
        pdf = pdfium.PdfDocument(path)
    except pdfium.PdfiumError as error:
        raise OcrError("The file could not be read as a PDF.") from error

    pages = []
    for index in range(min(len(pdf), MAX_PDF_PAGES)):
        rendered = pdf[index].render(scale=PDF_RENDER_SCALE).to_pil().convert("RGB")
        pages.append(cv2.cvtColor(np.array(rendered), cv2.COLOR_RGB2BGR))
    pdf.close()

    if not pages:
        raise OcrError("The PDF has no pages.")
    return pages
