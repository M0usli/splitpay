"""Time-based one-time passwords (TOTP): the 6-digit codes of an authenticator app.

How it works: the server and the phone share a secret once (the QR code).
After that, both can work out the same 6-digit number from the secret and
the current time, with no connection between them. The number changes
every 30 seconds.

This is the standard algorithm (RFC 6238, built on RFC 4226), written out
here because it is short and worth understanding. A real project would
normally use a library such as pyotp.
"""

import base64
import datetime
import hashlib
import hmac
import secrets
import struct
from urllib.parse import quote

DIGITS = 6
PERIOD_SECONDS = 30
# A phone's clock can be a little off, so the step before and after count too.
ALLOWED_DRIFT_STEPS = 1

ISSUER = "SplitPay"


def new_secret() -> str:
    """A random secret, written in base32, the alphabet authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(20)).decode()


def step_at(moment: datetime.datetime) -> int:
    """Which 30-second step a moment falls in, counted from 1 January 1970."""
    return int(moment.timestamp()) // PERIOD_SECONDS


def code_for(secret: str, step: int) -> str:
    """The code for one time step."""
    key = base64.b32decode(secret)
    # The step as 8 bytes, then a keyed hash of it: only someone with the secret can make this.
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    # "Dynamic truncation": the last half-byte says where to read 4 bytes from.
    offset = digest[-1] & 0x0F
    number = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(number % 10**DIGITS).zfill(DIGITS)


def matching_step(
    secret: str, code: str, moment: datetime.datetime, last_used_step: int | None
) -> int | None:
    """The time step `code` is valid for, or None if it is not valid.

    A step at or before `last_used_step` is refused, so a code that was
    already used cannot be used again by someone who saw it (a replay).
    """
    now = step_at(moment)
    for step in range(now - ALLOWED_DRIFT_STEPS, now + ALLOWED_DRIFT_STEPS + 1):
        if last_used_step is not None and step <= last_used_step:
            continue
        # compare_digest takes the same time whether or not the codes match,
        # so the time it takes gives nothing away.
        if hmac.compare_digest(code_for(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, email: str) -> str:
    """The address inside the set-up QR code, in the format authenticator apps read."""
    label = quote(f"{ISSUER}:{email}")
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={ISSUER}"
        f"&digits={DIGITS}&period={PERIOD_SECONDS}"
    )
