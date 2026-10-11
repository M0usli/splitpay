"""OCR: turning a receipt image into raw text."""

from typing import Annotated

from fastapi import Depends

from app.ocr.base import OcrEngine, OcrError
from app.ocr.tesseract import TesseractEngine

__all__ = ["OcrEngine", "OcrEngineDep", "OcrError", "get_ocr_engine"]


def get_ocr_engine() -> OcrEngine:
    """Choose the OCR engine. Swapping engines means changing only this line."""
    return TesseractEngine()


# Endpoints declare a parameter of this type to receive the engine. Tests
# override get_ocr_engine with a fake, so they never run real OCR.
OcrEngineDep = Annotated[OcrEngine, Depends(get_ocr_engine)]
