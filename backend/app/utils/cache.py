"""
Cache layer: Redis if REDIS_URL is set, otherwise in-memory fallback.
Same synchronous interface in both cases (Redis ops are sub-ms).
"""
import os
import time
import json as _json

TTL = 3600  # 1 hour default

# ── In-memory fallback ────────────────────────────────────────────────────────
_mem: dict[str, tuple[object, float, int]] = {}  # key → (value, stored_at, ttl)


def _mem_get(key: str):
    entry = _mem.get(key)
    if entry is None:
        return None
    value, ts, ttl = entry
    if time.time() - ts > ttl:
        del _mem[key]
        return None
    return value


def _mem_set(key: str, value, ttl: int = TTL):
    _mem[key] = (value, time.time(), ttl)


# ── Redis client (lazy init) ──────────────────────────────────────────────────
_redis = None


def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis as _redis_lib
        _redis = _redis_lib.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        _redis.ping()  # verify connection at startup
        return _redis
    except Exception:
        _redis = None
        return None


# ── Public API ────────────────────────────────────────────────────────────────
def get(key: str):
    r = _get_redis()
    if r is not None:
        try:
            raw = r.get(key)
            return _json.loads(raw) if raw is not None else None
        except Exception:
            pass
    return _mem_get(key)


def set(key: str, value, ttl: int = TTL):
    r = _get_redis()
    if r is not None:
        try:
            r.setex(key, ttl, _json.dumps(value, default=str))
            return
        except Exception:
            pass
    _mem_set(key, value, ttl)
