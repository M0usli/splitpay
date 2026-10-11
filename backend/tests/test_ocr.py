"""Tests for the OCR building blocks: preprocessing, file loading and storage."""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.ocr.base import OcrError
from app.ocr.loading import MAX_PDF_PAGES, load_pages
from app.ocr.pipeline import extract_text
from app.ocr.preprocessing import (
    deskew,
    estimate_skew_correction,
    preprocess_image,
    resize_to_width,
    rotate,
    threshold,
    to_grayscale,
)
from app.ocr.tesseract import TesseractEngine
from app.storage import detect_file_extension, save_upload
from tests.samples import encode, make_pdf, make_text_image

# --- preprocessing ---


def test_to_grayscale_removes_the_colour_channels():
    colour = make_text_image()

    gray = to_grayscale(colour)

    assert colour.ndim == 3
    assert gray.shape == colour.shape[:2]


def test_to_grayscale_leaves_a_gray_image_alone():
    gray = to_grayscale(make_text_image())

    assert to_grayscale(gray) is gray


def test_resize_shrinks_a_large_image_to_the_target_width():
    large = np.zeros((3000, 2400), dtype=np.uint8)

    resized = resize_to_width(large, 1200)

    assert resized.shape == (1500, 1200)


def test_resize_enlarges_a_small_image_but_only_up_to_three_times():
    tiny = np.zeros((100, 200), dtype=np.uint8)

    resized = resize_to_width(tiny, 1200)

    assert resized.shape == (300, 600)


def test_threshold_produces_only_black_and_white():
    gray = to_grayscale(make_text_image())

    binary = threshold(gray)

    assert set(np.unique(binary)) == {0, 255}


def test_threshold_keeps_text_readable_under_a_shadow():
    gray = to_grayscale(make_text_image()).astype(np.float32)
    # Darken the image gradually from left (full brightness) to right (40%).
    shadow = np.linspace(1.0, 0.4, gray.shape[1], dtype=np.float32)
    shadowed = (gray * shadow).astype(np.uint8)

    binary = threshold(shadowed)

    # The paper is white on both the bright side and the shadowed side...
    assert binary[5, 5] == 255
    assert binary[5, -5] == 255
    # ...and the text is still there.
    assert (binary == 0).sum() > 1000


def test_skew_estimate_is_zero_for_a_level_image():
    binary = threshold(to_grayscale(make_text_image()))

    assert estimate_skew_correction(binary) == 0.0


@pytest.mark.parametrize("tilt", [-6.0, -3.0, 4.0, 7.0])
def test_skew_estimate_finds_the_tilt(tilt: float):
    level = threshold(to_grayscale(make_text_image()))
    tilted = rotate(level, tilt, border_value=255)

    correction = estimate_skew_correction(tilted)

    # The correction is the opposite of the tilt, within one search step.
    assert correction == pytest.approx(-tilt, abs=1.0)


def test_deskew_levels_a_tilted_image():
    level = threshold(to_grayscale(make_text_image()))
    tilted = rotate(level, 5.0, border_value=255)

    straightened = deskew(tilted)

    assert abs(estimate_skew_correction(straightened)) <= 0.5


def test_preprocess_image_returns_a_standard_black_and_white_image():
    result = preprocess_image(make_text_image())

    assert result.ndim == 2
    assert result.dtype == np.uint8
    assert result.shape[1] == 1200


# --- loading files ---


def test_load_pages_reads_an_image_as_one_page(tmp_path: Path):
    path = tmp_path / "receipt.png"
    path.write_bytes(encode(make_text_image(), ".png"))

    pages = load_pages(path)

    assert len(pages) == 1
    assert pages[0].shape == make_text_image().shape


def test_load_pages_limits_how_many_pdf_pages_are_read(tmp_path: Path):
    path = tmp_path / "long.pdf"
    path.write_bytes(make_pdf(page_count=MAX_PDF_PAGES + 2))

    assert len(load_pages(path)) == MAX_PDF_PAGES


def test_load_pages_rejects_a_broken_pdf(tmp_path: Path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.7 this is not a real pdf")

    with pytest.raises(OcrError, match="could not be read as a PDF"):
        load_pages(path)


# --- storage ---


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (encode(make_text_image(), ".jpg"), ".jpg"),
        (encode(make_text_image(), ".png"), ".png"),
        (make_pdf(), ".pdf"),
        (b"GIF89a...", None),
        (b"", None),
    ],
)
def test_detect_file_extension(data: bytes, expected: str | None):
    assert detect_file_extension(data) == expected


def test_save_upload_gives_every_file_its_own_name(tmp_path: Path):
    first = save_upload(b"one", ".png", tmp_path)
    second = save_upload(b"two", ".png", tmp_path)

    assert first != second
    assert (tmp_path / first).read_bytes() == b"one"
    assert (tmp_path / second).read_bytes() == b"two"


# --- real Tesseract (the only test that runs actual OCR) ---


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed")
def test_tesseract_reads_a_clean_image(tmp_path: Path):
    path = tmp_path / "receipt.png"
    path.write_bytes(encode(make_text_image(), ".png"))

    text = extract_text(path, TesseractEngine())

    assert "LOBLAWS" in text
    assert "TOTAL 9.58" in text
