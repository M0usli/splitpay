"""Small generated images and files for tests, so no real receipts are needed."""

import io

import cv2
import numpy as np
from PIL import Image

RECEIPT_LINES = ["LOBLAWS", "MILK 4.99", "BREAD 3.49", "SUBTOTAL 8.48", "HST 1.10", "TOTAL 9.58"]


def make_text_image(lines: list[str] = RECEIPT_LINES, width: int = 800) -> np.ndarray:
    """A white colour image with black lines of text, like a tiny receipt."""
    line_height = 70
    image = np.full((line_height * (len(lines) + 1), width, 3), 255, dtype=np.uint8)
    for index, line in enumerate(lines):
        position = (40, line_height * (index + 1))
        cv2.putText(image, line, position, cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    return image


def encode(image: np.ndarray, extension: str) -> bytes:
    """Encode an image as ".png" or ".jpg" bytes."""
    succeeded, buffer = cv2.imencode(extension, image)
    assert succeeded
    return buffer.tobytes()


def make_pdf(page_count: int = 1) -> bytes:
    """A PDF where every page is a picture of the sample receipt."""
    page = Image.fromarray(cv2.cvtColor(make_text_image(), cv2.COLOR_BGR2RGB))
    buffer = io.BytesIO()
    page.save(buffer, format="PDF", save_all=True, append_images=[page] * (page_count - 1))
    return buffer.getvalue()
