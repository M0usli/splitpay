"""Limits on how often something may be tried, to stop guessing and abuse.

A "sliding window" limit: at most `limit` tries in the last `window`
seconds. Each try's time is remembered; tries older than the window are
forgotten.

The counts are kept in this process's memory. That is enough for one
server, which is what a free host gives. Several servers would each count
on their own, so a bigger deployment keeps the counts in a shared store
such as Redis instead.
"""

import math
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self) -> None:
        self._tries: dict[str, deque[float]] = defaultdict(deque)
        # Requests are handled in several threads; the lock stops two of them
        # changing the same list at once.
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> int | None:
        """Count one try. Returns the seconds to wait if it is over the limit, else None."""
        now = time.monotonic()
        with self._lock:
            tries = self._tries[key]
            while tries and tries[0] <= now - window_seconds:
                tries.popleft()
            if len(tries) >= limit:
                # The oldest try leaves the window first; then there is room again.
                return max(1, math.ceil(tries[0] + window_seconds - now))
            tries.append(now)
            return None

    def reset(self) -> None:
        """Forget every count. Used between tests."""
        with self._lock:
            self._tries.clear()


limiter = RateLimiter()


def client_address(request: Request) -> str:
    """The address the request came from.

    Behind a host's proxy this is the proxy's address unless the server is
    started with uvicorn's --proxy-headers, which reads the real one from
    the X-Forwarded-For header that the proxy adds.
    """
    return request.client.host if request.client is not None else "unknown"


def too_many(retry_after: int) -> HTTPException:
    minutes = math.ceil(retry_after / 60)
    wait = "a minute" if minutes <= 1 else f"{minutes} minutes"
    # 429 Too Many Requests, with Retry-After telling the client how long to wait.
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Too many attempts. Try again in {wait}.",
        headers={"Retry-After": str(retry_after)},
    )


def limit_by_address(name: str, limit: int, window_seconds: int):
    """A dependency that allows `limit` requests per `window_seconds` from one address."""

    def check(request: Request) -> None:
        retry_after = limiter.hit(f"{name}:{client_address(request)}", limit, window_seconds)
        if retry_after is not None:
            raise too_many(retry_after)

    return check
