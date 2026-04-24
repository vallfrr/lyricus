import asyncio
import json as json_mod
import os
import random
from datetime import datetime, timedelta, timezone

import aiohttp
from sanic import Blueprint, json
from sanic.exceptions import SanicException

from app.utils.jwt_utils import get_user_from_request

daily_bp = Blueprint("daily", url_prefix="/api")

LRCLIB_BASE = "https://lrclib.net/api"
LASTFM_API_KEY = os.environ.get("LASTFM_API_KEY", "b25b959554ed76058ac220b7b2e0a026")
LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
MAX_REROLLS = 3


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_today():
    return datetime.now(timezone.utc).date()  # returns a date object for asyncpg


def _seconds_until_midnight() -> int:
    now = datetime.now(timezone.utc)
    midnight = datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1)
    return max(60, int((midnight - now).total_seconds()))


async def _has_lyrics(session: aiohttp.ClientSession, artist: str, title: str) -> bool:
    try:
        async with session.get(
            f"{LRCLIB_BASE}/get",
            params={"artist_name": artist, "track_name": title},
            timeout=aiohttp.ClientTimeout(total=4),
        ) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                return bool(data.get("plainLyrics"))
    except Exception:
        pass
    return False


async def _deezer_enrich(session: aiohttp.ClientSession, artist: str, title: str) -> dict:
    try:
        async with session.get(
            "https://api.deezer.com/search",
            params={"q": f"{artist} {title}", "limit": 1},
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                tracks = data.get("data", [])
                if tracks:
                    t = tracks[0]
                    return {
                        "cover":   t.get("album", {}).get("cover_medium", ""),
                        "preview": t.get("preview", ""),
                        "album":   t.get("album", {}).get("title", ""),
                    }
    except Exception:
        pass
    return {"cover": "", "preview": "", "album": ""}


async def _lastfm_similar(session: aiohttp.ClientSession, artist: str, title: str, limit: int = 10) -> list[tuple[str, str]]:
    try:
        async with session.get(
            LASTFM_BASE,
            params={
                "method": "track.getSimilar",
                "artist": artist,
                "track": title,
                "limit": limit,
                "autocorrect": 1,
                "api_key": LASTFM_API_KEY,
                "format": "json",
            },
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                tracks = data.get("similartracks", {}).get("track", [])
                return [
                    (t.get("artist", {}).get("name", ""), t.get("name", ""))
                    for t in tracks
                    if t.get("artist", {}).get("name") and t.get("name")
                ]
    except Exception:
        pass
    return []


async def _lastfm_top_tracks(session: aiohttp.ClientSession, artist: str, limit: int = 15) -> list[tuple[str, str]]:
    try:
        async with session.get(
            LASTFM_BASE,
            params={
                "method": "artist.getTopTracks",
                "artist": artist,
                "limit": limit,
                "autocorrect": 1,
                "api_key": LASTFM_API_KEY,
                "format": "json",
            },
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                tracks = data.get("toptracks", {}).get("track", [])
                return [(artist, t.get("name", "")) for t in tracks if t.get("name")]
    except Exception:
        pass
    return []


async def _generate_challenge(
    session: aiohttp.ClientSession,
    pool,
    user_id: str,
    exclude: set[tuple[str, str]],
) -> dict | None:
    """Pick a personalised song from Last.fm based on play history."""
    rows = await pool.fetch(
        """
        SELECT artist, title FROM game_sessions
        WHERE user_id = $1 AND status = 'finished'
        ORDER BY played_at DESC LIMIT 50
        """,
        user_id,
    )
    history = [(r["artist"], r["title"]) for r in rows]
    history_set = {(a.lower(), t.lower()) for a, t in history}
    full_exclude = history_set | {(a.lower(), t.lower()) for a, t in exclude}
    game_count = len(history)

    if game_count == 0:
        return None

    # Gather candidates
    raw: list[tuple[str, str]] = []

    if game_count < 5:
        # Top tracks from played artists (preserve artist order)
        played_artists = list(dict.fromkeys(a for a, _ in history))
        tasks = [_lastfm_top_tracks(session, a, 15) for a in played_artists[:5]]
        for tracks in await asyncio.gather(*tasks):
            raw.extend(tracks)
    else:
        # Similar tracks to recent plays
        recent = history[:10]
        tasks = [_lastfm_similar(session, a, t, 10) for a, t in recent]
        for tracks in await asyncio.gather(*tasks):
            raw.extend(tracks)

    # Deduplicate while preserving order
    seen: set[tuple[str, str]] = set()
    candidates: list[tuple[str, str]] = []
    for a, t in raw:
        key = (a.lower(), t.lower())
        if key not in seen and key not in full_exclude:
            seen.add(key)
            candidates.append((a, t))

    if not candidates:
        return None

    random.shuffle(candidates)
    for artist, title in candidates[:30]:
        if await _has_lyrics(session, artist, title):
            enrich = await _deezer_enrich(session, artist, title)
            return {"artist": artist, "title": title, **enrich}

    return None


def _row_to_dict(row, ttl: int, preview: str = "") -> dict:
    return {
        "artist":           row["artist"],
        "title":            row["title"],
        "album":            row["album"] or "",
        "cover":            row["cover"] or "",
        "preview":          preview,
        "rerolls_used":     row["rerolls_used"],
        "rerolls_remaining": MAX_REROLLS - row["rerolls_used"],
        "completed":        row["completed_at"] is not None,
        "completed_at":     row["completed_at"].isoformat() if row["completed_at"] else None,
        "seconds_until_reset": ttl,
    }


async def _maybe_mark_completed(pool, user_id: str, date: str, artist: str, title: str):
    """Auto-mark completed if a finished game session matches today's challenge."""
    await pool.execute(
        """
        UPDATE daily_challenges SET completed_at = NOW()
        WHERE user_id = $1 AND date = $2 AND completed_at IS NULL
          AND EXISTS (
              SELECT 1 FROM game_sessions
              WHERE user_id = $1
                AND LOWER(artist) = LOWER($3)
                AND LOWER(title)  = LOWER($4)
                AND status = 'finished'
                AND played_at >= (CURRENT_DATE AT TIME ZONE 'UTC')
          )
        """,
        user_id, date, artist, title,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@daily_bp.get("/daily")
async def get_daily(request):
    payload = get_user_from_request(request)
    if not payload:
        return json({"locked": True, "reason": "auth"})

    user_id = payload["sub"]
    pool = request.app.ctx.pool
    today = _utc_today()
    ttl = _seconds_until_midnight()

    # Return existing challenge for today (auto-check completion)
    row = await pool.fetchrow(
        "SELECT * FROM daily_challenges WHERE user_id = $1 AND date = $2",
        user_id, today,
    )
    if row:
        await _maybe_mark_completed(pool, user_id, today, row["artist"], row["title"])
        row = await pool.fetchrow(
            "SELECT * FROM daily_challenges WHERE user_id = $1 AND date = $2",
            user_id, today,
        )
        enrich = await _deezer_enrich(request.app.ctx.session, row["artist"], row["title"])
        return json(_row_to_dict(row, ttl, enrich["preview"]))

    # Check if user has at least one finished game
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id = $1 AND status = 'finished'",
        user_id,
    )
    if count == 0:
        return json({"locked": True, "reason": "no_games"})

    # Generate a new challenge
    challenge = await _generate_challenge(request.app.ctx.session, pool, user_id, set())
    if not challenge:
        return json({"error": "unavailable"}, status=503)

    row = await pool.fetchrow(
        """
        INSERT INTO daily_challenges (user_id, date, artist, title, album, cover)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, date) DO UPDATE SET artist = EXCLUDED.artist
        RETURNING *
        """,
        user_id, today,
        challenge["artist"], challenge["title"],
        challenge.get("album", ""), challenge.get("cover", ""),
    )
    return json(_row_to_dict(row, ttl, challenge.get("preview", "")))


@daily_bp.post("/daily/reroll")
async def reroll_daily(request):
    payload = get_user_from_request(request)
    if not payload:
        raise SanicException("Unauthorized", status_code=401)

    user_id = payload["sub"]
    pool = request.app.ctx.pool
    today = _utc_today()
    ttl = _seconds_until_midnight()

    row = await pool.fetchrow(
        "SELECT * FROM daily_challenges WHERE user_id = $1 AND date = $2",
        user_id, today,
    )
    if not row:
        raise SanicException("No active daily challenge", status_code=404)
    if row["rerolls_used"] >= MAX_REROLLS:
        raise SanicException("No rerolls remaining", status_code=429)
    if row["completed_at"] is not None:
        raise SanicException("Challenge already completed", status_code=400)

    reroll_history = json_mod.loads(row["reroll_history"]) if row["reroll_history"] else []
    exclude = {(e["artist"].lower(), e["title"].lower()) for e in reroll_history}
    exclude.add((row["artist"].lower(), row["title"].lower()))

    challenge = await _generate_challenge(
        request.app.ctx.session, pool, user_id,
        {(a, t) for a, t in exclude},
    )
    if not challenge:
        raise SanicException("No candidates available", status_code=503)

    reroll_history.append({"artist": row["artist"], "title": row["title"]})

    updated = await pool.fetchrow(
        """
        UPDATE daily_challenges
        SET artist = $1, title = $2, album = $3, cover = $4,
            rerolls_used = rerolls_used + 1,
            reroll_history = $5::jsonb
        WHERE user_id = $6 AND date = $7
        RETURNING *
        """,
        challenge["artist"], challenge["title"],
        challenge.get("album", ""), challenge.get("cover", ""),
        json_mod.dumps(reroll_history),
        user_id, today,
    )
    return json(_row_to_dict(updated, ttl, challenge.get("preview", "")))
