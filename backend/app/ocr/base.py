"""The interface every OCR engine has to follow."""

from typing import Protocol

import numpy as np


class OcrError(Exception):
    """Reading a receipt failed. The message is safe to show to the user."""


class OcrEngine(Protocol):
    """Anything with this method can be used as an OCR engine.

    A Protocol describes a shape rather than a parent class: TesseractEngine
    does not inherit from OcrEngine, it only needs a matching method. To add
    EasyOCR later, write another class with this method and return it from
    get_ocr_engine().
    """

    def image_to_text(self, image: np.ndarray) -> str:
        """Return the text found in an image (an OpenCV array)."""
        ...
