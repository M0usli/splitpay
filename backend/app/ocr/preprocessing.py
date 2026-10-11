"""Clean up a receipt photo so the OCR engine can read it more accurately.

Images are OpenCV arrays: a grid of pixels where 0 is black and 255 is white.
Each step is its own small function so it can be tested and explained alone.
"""

import cv2
import numpy as np

TARGET_WIDTH = 1200
MAX_UPSCALE = 3.0
MAX_SKEW_DEGREES = 10.0
SKEW_STEP_DEGREES = 0.5


def to_grayscale(image: np.ndarray) -> np.ndarray:
    """Drop the colour. OCR only needs light versus dark."""
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def resize_to_width(image: np.ndarray, width: int = TARGET_WIDTH) -> np.ndarray:
    """Scale the image to a standard width so letters are a readable size.

    Phone photos are much larger than needed (slow), and small scans have
    letters too tiny for Tesseract.
    """
    scale = min(width / image.shape[1], MAX_UPSCALE)
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=interpolation)


def denoise(gray: np.ndarray) -> np.ndarray:
    """Smooth out camera grain and paper texture while keeping letter edges."""
    return cv2.fastNlMeansDenoising(gray, h=10)


def threshold(gray: np.ndarray) -> np.ndarray:
    """Turn every pixel pure black or pure white.

    "Adaptive" means each pixel is compared with its own neighbourhood, not
    with one cut-off for the whole image, so shadows and uneven lighting
    across the receipt do not swallow the text.
    """
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=15,
    )


def rotate(image: np.ndarray, degrees: float, border_value: int) -> np.ndarray:
    """Rotate around the centre. Positive degrees turn counter-clockwise."""
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border_value,
    )


def estimate_skew_correction(binary: np.ndarray) -> float:
    """Find the rotation (in degrees) that makes the lines of text level.

    Idea: count the dark pixels in every row. When text is level, rows are
    either full of ink (a line of text) or empty (a gap), so the counts vary
    a lot. When text is tilted, the ink smears across rows and the counts
    even out. We try a range of small rotations and keep the one where the
    row counts vary the most.
    """
    small = resize_to_width(binary, 400)
    ink = (small < 128).astype(np.float32)

    best_angle = 0.0
    best_score = -1.0
    for angle in np.arange(-MAX_SKEW_DEGREES, MAX_SKEW_DEGREES + 0.01, SKEW_STEP_DEGREES):
        ink_per_row = rotate(ink, float(angle), border_value=0).sum(axis=1)
        score = float(np.var(ink_per_row))
        if score > best_score:
            best_score = score
            best_angle = float(angle)
    return best_angle


def deskew(binary: np.ndarray) -> np.ndarray:
    """Straighten a slightly tilted receipt."""
    angle = estimate_skew_correction(binary)
    if abs(angle) < SKEW_STEP_DEGREES:
        return binary
    return rotate(binary, angle, border_value=255)


def preprocess_image(image: np.ndarray) -> np.ndarray:
    """Run every step in order and return a clean black-and-white image."""
    gray = to_grayscale(image)
    gray = resize_to_width(gray)
    gray = denoise(gray)
    binary = threshold(gray)
    return deskew(binary)
