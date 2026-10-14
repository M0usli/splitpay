import datetime
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.config import SettingsDep
from app.database import DbSession
from app.enums import ReceiptStatus
from app.extraction import ExtractionError, LlmClient, LlmClientDep
from app.extraction.extractor import extract_fields
from app.models import Receipt, User
from app.ocr import OcrEngineDep, OcrError
from app.ocr.loading import encode_png, load_pages
from app.ocr.pipeline import extract_text
from app.ocr.preprocessing import preprocess_image
from app.rate_limit import limiter, too_many
from app.schemas.receipt import ReceiptRead
from app.storage import detect_file_extension, save_upload

router = APIRouter(prefix="/receipts", tags=["receipts"])

# Failures are shown to the user and also written to the server log, so they
# can be investigated later.
logger = logging.getLogger(__name__)


def get_receipt_or_404(db: Session, user: User, receipt_id: int) -> Receipt:
    """Find one of the user's own receipts. Someone else's receipt gives 404."""
    receipt = db.get(Receipt, receipt_id)
    if receipt is None or receipt.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    return receipt


@router.post("", response_model=ReceiptRead, status_code=status.HTTP_201_CREATED)
def upload_receipt(
    file: UploadFile,
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDep,
    ocr_engine: OcrEngineDep,
    llm: LlmClientDep,
    preprocess: bool = True,
) -> Receipt:
    """Upload a receipt (JPG, PNG or PDF), run OCR, then extract its fields.

    Set `preprocess=false` to skip the image clean-up and compare results.
    If OCR or extraction fails, the receipt is still saved, with status
    "failed" and a message explaining why.
    """
    # Each upload is a paid AI call, so one user may only do so many a day.
    midnight = datetime.datetime.now(datetime.UTC).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    uploaded_today = db.scalar(
        select(func.count())
        .select_from(Receipt)
        .where(Receipt.user_id == user.id)
        .where(Receipt.created_at >= midnight)
    )
    if uploaded_today >= settings.daily_scan_limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"You can scan {settings.daily_scan_limit} receipts a day. "
            "Try again tomorrow, or add this expense by hand.",
        )

    # Read one byte more than the limit so an oversized file is detected
    # without loading all of it into memory.
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, detail=f"File is larger than {limit_mb} MB."
        )

    extension = detect_file_extension(data)
    if extension is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported file type. Upload a JPG, PNG or PDF.",
        )

    filename = save_upload(data, extension, settings.upload_dir)
    receipt = Receipt(file_path=filename, user_id=user.id)
    db.add(receipt)
    db.commit()

    try:
        receipt.raw_text = extract_text(
            settings.upload_dir / filename, ocr_engine, preprocess=preprocess
        )
    except OcrError as error:
        logger.warning("OCR failed for receipt %s: %s", receipt.id, error)
        receipt.status = ReceiptStatus.FAILED
        receipt.error_message = str(error)
    else:
        run_extraction(receipt, llm)

    db.commit()
    db.refresh(receipt)
    return receipt


def run_extraction(receipt: Receipt, llm: LlmClient) -> None:
    """Extract fields from the receipt's OCR text and record the outcome on it."""
    try:
        fields = extract_fields(receipt.raw_text or "", llm)
    except ExtractionError as error:
        logger.warning("Extraction failed for receipt %s: %s", receipt.id, error)
        receipt.status = ReceiptStatus.FAILED
        receipt.error_message = str(error)
        return
    # mode="json" turns dates and decimals into strings so they fit in a JSON column.
    receipt.extracted_fields = fields.model_dump(mode="json")
    receipt.status = ReceiptStatus.EXTRACTED
    receipt.error_message = None


@router.get("/{receipt_id}", response_model=ReceiptRead)
def get_receipt(receipt_id: int, db: DbSession, user: CurrentUser) -> Receipt:
    return get_receipt_or_404(db, user, receipt_id)


@router.post("/{receipt_id}/extract", response_model=ReceiptRead)
def rerun_extraction(
    receipt_id: int, db: DbSession, user: CurrentUser, llm: LlmClientDep
) -> Receipt:
    """Run the AI extraction again on a receipt's stored OCR text.

    Useful after a failed extraction (for example the AI service was down),
    without having to upload the file again.
    """
    # Running the AI again costs the same as a new scan: 10 an hour per user.
    retry_after = limiter.hit(f"extract:{user.id}", limit=10, window_seconds=3600)
    if retry_after is not None:
        raise too_many(retry_after)
    receipt = get_receipt_or_404(db, user, receipt_id)
    if not receipt.raw_text:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This receipt has no OCR text to extract from."
        )
    run_extraction(receipt, llm)
    db.commit()
    db.refresh(receipt)
    return receipt


@router.get(
    "/{receipt_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/png": {}, "image/jpeg": {}}}},
)
def get_receipt_image(
    receipt_id: int,
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDep,
    processed: bool = False,
) -> Response:
    """Serve the uploaded receipt as an image.

    A PDF is shown as a picture of its first page. With `processed=true` the
    response is the cleaned-up image that the OCR engine actually read.
    """
    receipt = get_receipt_or_404(db, user, receipt_id)
    path: Path = settings.upload_dir / receipt.file_path
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Receipt file not found")

    if not processed and path.suffix != ".pdf":
        return FileResponse(path)

    try:
        image = load_pages(path)[0]
    except OcrError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    if processed:
        image = preprocess_image(image)
    return Response(content=encode_png(image), media_type="image/png")
