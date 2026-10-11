from fastapi.testclient import TestClient

from app.config import Settings
from app.extraction import ExtractionError
from app.ocr import OcrError
from tests.conftest import GOOD_REPLY, FakeLlmClient, FakeOcrEngine
from tests.samples import encode, make_pdf, make_text_image

PNG = encode(make_text_image(), ".png")
JPG = encode(make_text_image(), ".jpg")


def upload(client: TestClient, data: bytes, filename: str = "receipt.png", **params):
    return client.post("/receipts", files={"file": (filename, data)}, params=params)


# --- upload ---


def test_upload_runs_ocr_and_returns_the_raw_text(client: TestClient, fake_ocr: FakeOcrEngine):
    fake_ocr.text = "LOBLAWS\nTOTAL 9.58\n"

    response = upload(client, PNG)

    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["status"] == "extracted"
    assert body["raw_text"] == "LOBLAWS\nTOTAL 9.58"
    assert body["error_message"] is None


def test_upload_saves_the_file_to_the_upload_folder(client: TestClient, test_settings: Settings):
    upload(client, PNG)

    saved_files = list(test_settings.upload_dir.iterdir())
    assert len(saved_files) == 1
    assert saved_files[0].suffix == ".png"
    assert saved_files[0].read_bytes() == PNG


def test_upload_accepts_jpg(client: TestClient):
    response = upload(client, JPG, "photo.jpg")

    assert response.status_code == 201
    assert response.json()["status"] == "extracted"


def test_upload_accepts_pdf_and_reads_every_page(client: TestClient, fake_ocr: FakeOcrEngine):
    fake_ocr.text = "PAGE TEXT"

    response = upload(client, make_pdf(page_count=2), "receipt.pdf")

    assert response.status_code == 201
    assert response.json()["raw_text"] == "PAGE TEXT\n\nPAGE TEXT"


def test_upload_preprocesses_the_image_by_default(client: TestClient, fake_ocr: FakeOcrEngine):
    upload(client, PNG)

    image = fake_ocr.received_images[0]
    assert image.ndim == 2  # black and white, no colour channels
    assert image.shape[1] == 1200  # resized to the standard width


def test_upload_can_skip_preprocessing(client: TestClient, fake_ocr: FakeOcrEngine):
    upload(client, PNG, preprocess="false")

    image = fake_ocr.received_images[0]
    assert image.ndim == 3  # still the original colour image
    assert image.shape[1] == 800


def test_upload_rejects_a_file_that_is_not_an_image_or_pdf(client: TestClient):
    response = upload(client, b"just some text", "notes.png")

    assert response.status_code == 415
    assert "Unsupported file type" in response.json()["detail"]


def test_upload_rejects_a_file_over_the_size_limit(client: TestClient, test_settings: Settings):
    test_settings.max_upload_bytes = len(PNG) - 1

    response = upload(client, PNG)

    assert response.status_code == 413


def test_upload_requires_a_file(client: TestClient):
    response = client.post("/receipts")

    assert response.status_code == 422


def test_ocr_failure_marks_the_receipt_as_failed(client: TestClient, fake_ocr: FakeOcrEngine):
    fake_ocr.error = OcrError("The OCR engine could not process this image.")

    response = upload(client, PNG)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "failed"
    assert body["error_message"] == "The OCR engine could not process this image."
    assert body["raw_text"] is None


def test_image_with_no_text_marks_the_receipt_as_failed(
    client: TestClient, fake_ocr: FakeOcrEngine
):
    fake_ocr.text = "   \n"

    response = upload(client, PNG)

    assert response.json()["status"] == "failed"
    assert response.json()["error_message"] == "No text could be found in this file."


def test_corrupt_image_marks_the_receipt_as_failed(client: TestClient):
    corrupt_png = PNG[:20] + b"not really image data"

    response = upload(client, corrupt_png)

    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert response.json()["error_message"] == "The file could not be read as an image."


# --- get one ---


def test_get_receipt(client: TestClient):
    created = upload(client, PNG).json()

    response = client.get(f"/receipts/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_receipt_returns_404(client: TestClient):
    response = client.get("/receipts/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Receipt not found"


# --- image ---


def test_image_returns_the_uploaded_file(client: TestClient):
    created = upload(client, JPG, "photo.jpg").json()

    response = client.get(f"/receipts/{created['id']}/image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == JPG


def test_image_of_a_pdf_is_a_png_of_the_first_page(client: TestClient):
    created = upload(client, make_pdf(), "receipt.pdf").json()

    response = client.get(f"/receipts/{created['id']}/image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_processed_image_is_a_png(client: TestClient):
    created = upload(client, JPG, "photo.jpg").json()

    response = client.get(f"/receipts/{created['id']}/image", params={"processed": "true"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_image_of_missing_receipt_returns_404(client: TestClient):
    response = client.get("/receipts/999/image")

    assert response.status_code == 404


# --- extraction (the AI step that follows OCR) ---


def test_upload_returns_the_extracted_fields(client: TestClient):
    response = upload(client, PNG)

    body = response.json()
    assert body["status"] == "extracted"
    assert body["extracted_fields"] == {
        "merchant": "Loblaws",
        "date": "2026-10-05",
        "subtotal": "8.48",
        "tax": "1.10",
        "total": "9.58",
        "currency": None,
        "category": "Groceries",
        "items": [],
    }
    assert body["warnings"] == []
    assert body["needs_review"] is False


def test_extraction_is_given_the_ocr_text(
    client: TestClient, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
):
    fake_ocr.text = "LOBLAWS\nTOTAL 9.58"

    upload(client, PNG)

    assert "LOBLAWS\nTOTAL 9.58" in fake_llm.user_messages[0]


def test_receipt_is_flagged_when_amounts_do_not_add_up(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.replies = [GOOD_REPLY.replace('"9.58"', '"19.58"')]

    body = upload(client, PNG).json()

    assert body["status"] == "extracted"
    assert body["needs_review"] is True
    assert "Subtotal + tax is 9.58, but the total is 19.58" in body["warnings"][0]


def test_receipt_is_flagged_when_a_key_field_is_missing(
    client: TestClient, fake_llm: FakeLlmClient
):
    fake_llm.replies = [GOOD_REPLY.replace('"2026-10-05"', "null")]

    body = upload(client, PNG).json()

    assert body["extracted_fields"]["date"] is None
    assert body["warnings"] == ["The date could not be found."]


def test_invalid_ai_reply_is_retried_once(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.replies = ["this is not json", GOOD_REPLY]

    body = upload(client, PNG).json()

    assert body["status"] == "extracted"
    assert len(fake_llm.user_messages) == 2


def test_receipt_fails_after_two_invalid_ai_replies(
    client: TestClient, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
):
    fake_ocr.text = "LOBLAWS\nTOTAL 9.58"
    fake_llm.replies = ["this is not json", "still not json"]

    response = upload(client, PNG)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "failed"
    assert "did not match the expected format" in body["error_message"]
    assert body["extracted_fields"] is None
    # The OCR text is kept, so the user can still enter the expense by hand.
    assert body["raw_text"] == "LOBLAWS\nTOTAL 9.58"


def test_ai_service_error_marks_the_receipt_as_failed(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.error = ExtractionError("Could not reach the AI service.")

    body = upload(client, PNG).json()

    assert body["status"] == "failed"
    assert body["error_message"] == "Could not reach the AI service."


def test_ai_is_not_called_when_ocr_fails(
    client: TestClient, fake_ocr: FakeOcrEngine, fake_llm: FakeLlmClient
):
    fake_ocr.text = ""

    upload(client, PNG)

    assert fake_llm.user_messages == []


# --- running extraction again ---


def test_extraction_can_be_run_again_after_a_failure(client: TestClient, fake_llm: FakeLlmClient):
    fake_llm.error = ExtractionError("Could not reach the AI service.")
    failed = upload(client, PNG).json()
    assert failed["status"] == "failed"

    fake_llm.error = None
    response = client.post(f"/receipts/{failed['id']}/extract")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "extracted"
    assert body["error_message"] is None
    assert body["extracted_fields"]["merchant"] == "Loblaws"


def test_extraction_cannot_run_without_ocr_text(client: TestClient, fake_ocr: FakeOcrEngine):
    fake_ocr.text = ""
    failed = upload(client, PNG).json()

    response = client.post(f"/receipts/{failed['id']}/extract")

    assert response.status_code == 409
    assert response.json()["detail"] == "This receipt has no OCR text to extract from."


def test_extraction_of_missing_receipt_returns_404(client: TestClient):
    response = client.post("/receipts/999/extract")

    assert response.status_code == 404
