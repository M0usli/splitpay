"""Saving uploaded receipt files to disk."""

import uuid
from pathlib import Path

# The first bytes of a file identify its real type. We check these instead of
# trusting the file name or the type the browser claims.
FILE_SIGNATURES = {
    b"\xff\xd8\xff": ".jpg",
    b"\x89PNG\r\n\x1a\n": ".png",
    b"%PDF-": ".pdf",
}


def detect_file_extension(data: bytes) -> str | None:
    """Return ".jpg", ".png" or ".pdf", or None for any other kind of file."""
    for signature, extension in FILE_SIGNATURES.items():
        if data.startswith(signature):
            return extension
    return None


def save_upload(data: bytes, extension: str, upload_dir: Path) -> str:
    """Write the file under a random name and return that name.

    A random name means two uploads can never overwrite each other, and a
    user-supplied file name never ends up in a path on our disk.
    """
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    (upload_dir / filename).write_bytes(data)
    return filename
