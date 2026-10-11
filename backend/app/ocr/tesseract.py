import numpy as np
import pytesseract

from app.ocr.base import OcrError


class TesseractEngine:
    """OCR using the Tesseract program installed in the Docker image."""

    def __init__(self, language: str = "eng", page_segmentation_mode: int = 6) -> None:
        self.language = language
        # Mode 6 tells Tesseract to treat the image as one block of text lines,
        # which suits a receipt better than its default "find columns" mode.
        self.config = f"--psm {page_segmentation_mode}"

    def image_to_text(self, image: np.ndarray) -> str:
        try:
            return pytesseract.image_to_string(image, lang=self.language, config=self.config)
        except (pytesseract.TesseractError, pytesseract.TesseractNotFoundError) as error:
            raise OcrError("The OCR engine could not process this image.") from error
