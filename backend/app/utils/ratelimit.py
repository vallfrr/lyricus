import time
from collections import defaultdict

_store: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(ip: str, key: str = "", max_req: int = 20, window: int = 60) -> bool:
    """Sliding window rate limiter. Returns True if the request should be blocked."""
    bucket = f"{ip}:{key}"
    now = time.monotonic()
    cutoff = now - window
    prev = _store[bucket]
    # Clean old entries
    trimmed = [t for t in prev if t > cutoff]
    if len(trimmed) >= max_req:
        _store[bucket] = trimmed
        return True
    trimmed.append(now)
    _store[bucket] = trimmed
    return False


def rate_limit_response():
    from sanic import json as sanic_json
    return sanic_json({"error": "trop de requêtes, réessaie dans une minute"}, status=429)
