import asyncio
import hashlib
import json as json_mod
import os
import random
from datetime import datetime, timedelta, timezone

import aiohttp
from sanic import Blueprint, json
from sanic.exceptions import SanicException

from app.utils.jwt_utils import get_user_from_request
from app.routes.badges import check_and_award, check_daily_time_badges
from app.routes.songs import lrclib_get

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
    """Check if lrclib has plain lyrics for this track. Uses shared cache from songs.lrclib_get."""
    result = await lrclib_get(session, artist, title)
    return result is not None and bool(result.get("plainLyrics"))


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


async def _generate_challenges(
    session: aiohttp.ClientSession,
    pool,
    user_id: str,
    exclude: set[tuple[str, str]],
    count: int = 4,
) -> list[dict]:
    """Pick `count` personalised songs in parallel. Returns between 0 and count results."""
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
        return []

    # Gather raw candidates from Last.fm
    raw: list[tuple[str, str]] = []
    if game_count < 5:
        played_artists = list(dict.fromkeys(a for a, _ in history))
        # Request more tracks per artist to widen the pool
        tasks = [_lastfm_top_tracks(session, a, 30) for a in played_artists[:5]]
        for tracks in await asyncio.gather(*tasks):
            raw.extend(tracks)
    else:
        recent = history[:10]
        tasks = [_lastfm_similar(session, a, t, 15) for a, t in recent]
        for tracks in await asyncio.gather(*tasks):
            raw.extend(tracks)

    # Deduplicate
    seen: set[tuple[str, str]] = set()
    pool_candidates: list[tuple[str, str]] = []
    for a, t in raw:
        key = (a.lower(), t.lower())
        if key not in seen and key not in full_exclude:
            seen.add(key)
            pool_candidates.append((a, t))

    if not pool_candidates:
        return []

    random.shuffle(pool_candidates)

    # Check lyrics for ALL candidates in batches of 20, stop as soon as we have `count` valid
    valid: list[tuple[str, str]] = []
    for i in range(0, len(pool_candidates), 20):
        batch = pool_candidates[i:i + 20]
        results = await asyncio.gather(*[_has_lyrics(session, a, t) for a, t in batch])
        for (a, t), ok in zip(batch, results):
            if ok:
                valid.append((a, t))
        if len(valid) >= count:
            break
    valid = valid[:count]

    if not valid:
        return []

    # Enrich all valid songs in parallel
    enrich_results = await asyncio.gather(*[_deezer_enrich(session, a, t) for a, t in valid])
    return [{"artist": a, "title": t, **e} for (a, t), e in zip(valid, enrich_results)]


async def _fallback_challenges(
    session: aiohttp.ClientSession,
    pool,
    user_id: str,
    exclude: set[tuple[str, str]],
    count: int = 4,
) -> list[dict]:
    """Fallback: pick songs from Deezer global charts that have lyrics.
    Used when personalised generation fails (new users, niche artists, lrclib issues)."""
    DEEZER_BASE = "https://api.deezer.com"
    from app.utils import cache as cache_store

    # Build full exclude set from user history
    rows = await pool.fetch(
        "SELECT artist, title FROM game_sessions WHERE user_id = $1 AND status = 'finished'",
        user_id,
    )
    history_set = {(r["artist"].lower(), r["title"].lower()) for r in rows}
    full_exclude = history_set | {(a.lower(), t.lower()) for a, t in exclude}

    # Use cached Deezer global chart
    chart_key = "deezer:chart:0"
    tracks = cache_store.get(chart_key)
    if tracks is None:
        try:
            async with session.get(
                f"{DEEZER_BASE}/chart/0/tracks?limit=100",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as r:
                if r.status == 200:
                    data = await r.json(content_type=None)
                    tracks = data.get("data", [])
                    if tracks:
                        cache_store.set(chart_key, tracks)
        except Exception:
            pass

    if not tracks:
        return []

    random.shuffle(list(tracks))  # avoid always same ordering
    candidates = [
        (t["artist"]["name"], t["title_short"], t)
        for t in tracks
        if (t["artist"]["name"].lower(), t["title_short"].lower()) not in full_exclude
    ]

    valid: list[dict] = []
    for i in range(0, len(candidates), 20):
        batch = candidates[i:i + 20]
        results = await asyncio.gather(*[_has_lyrics(session, a, title) for a, title, _ in batch])
        for (a, title, raw_track), ok in zip(batch, results):
            if ok:
                valid.append({
                    "artist":  a,
                    "title":   title,
                    "album":   raw_track.get("album", {}).get("title", ""),
                    "cover":   raw_track.get("album", {}).get("cover_medium", ""),
                    "preview": raw_track.get("preview", ""),
                })
        if len(valid) >= count:
            break

    return valid[:count]


def _daily_seed(date, artist: str, title: str) -> int:
    """Deterministic seed for a given day + song so hidden words never change on refresh."""
    raw = f"{date}:{artist.lower()}:{title.lower()}"
    return int(hashlib.md5(raw.encode()).hexdigest()[:8], 16) % 100_000


def _row_to_dict(row, ttl: int, preview: str = "", streak: int = 0, longest_streak: int = 0) -> dict:
    seed = row["seed"] if row.get("seed") is not None else None
    return {
        "artist":            row["artist"],
        "title":             row["title"],
        "album":             row["album"] or "",
        "cover":             row["cover"] or "",
        "preview":           preview,
        "seed":              seed,
        "rerolls_used":      row["rerolls_used"],
        "rerolls_remaining": MAX_REROLLS - row["rerolls_used"],
        "completed":         row["completed_at"] is not None,
        "completed_at":      row["completed_at"].isoformat() if row["completed_at"] else None,
        "completion_rank":   row["completion_rank"] if row.get("completion_rank") else None,
        "abandoned":         row["abandoned_at"] is not None,
        "abandoned_at":      row["abandoned_at"].isoformat() if row["abandoned_at"] else None,
        "seconds_until_reset": ttl,
        "streak":            streak,
        "longest_streak":    longest_streak,
    }


async def _get_streak(pool, user_id: str) -> tuple[int, int]:
    row = await pool.fetchrow(
        "SELECT current_streak, longest_streak FROM users WHERE id=$1", user_id
    )
    return (row["current_streak"] or 0, row["longest_streak"] or 0) if row else (0, 0)


async def _maybe_mark_completed(pool, user_id: str, date, artist: str, title: str):
    """Auto-mark completed if a finished game session matches today's challenge.
    Updates streak and awards daily badges when first marked."""
    # Count how many users already completed their challenge today (for rank)
    rank = await pool.fetchval(
        "SELECT COUNT(*) + 1 FROM daily_challenges WHERE date = $1 AND completed_at IS NOT NULL",
        date,
    )

    status = await pool.execute(
        """
        UPDATE daily_challenges SET completed_at = NOW(), completion_rank = $5
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
        user_id, date, artist, title, rank,
    )

    if status != "UPDATE 1":
        return  # already completed or no matching game — nothing to do

    # Update streak
    user_row = await pool.fetchrow(
        "SELECT last_daily_date, current_streak, longest_streak FROM users WHERE id=$1", user_id
    )
    today_date = _utc_today()
    yesterday  = today_date - timedelta(days=1)
    last       = user_row["last_daily_date"] if user_row else None

    if last == yesterday:
        new_streak = (user_row["current_streak"] or 0) + 1
    elif last == today_date:
        new_streak = user_row["current_streak"] or 1
    else:
        new_streak = 1

    longest = max(user_row["longest_streak"] or 0, new_streak)
    await pool.execute(
        "UPDATE users SET current_streak=$1, longest_streak=$2, last_daily_date=$3 WHERE id=$4",
        new_streak, longest, today_date, user_id,
    )

    # Award time-of-day + general badges
    await check_daily_time_badges(pool, user_id)
    await check_and_award(pool, user_id)


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
        # Backfill seed for rows created before seed column was added
        if row["seed"] is None:
            seed = _daily_seed(today, row["artist"], row["title"])
            await pool.execute(
                "UPDATE daily_challenges SET seed=$1 WHERE user_id=$2 AND date=$3",
                seed, user_id, today,
            )
        await _maybe_mark_completed(pool, user_id, today, row["artist"], row["title"])
        row = await pool.fetchrow(
            "SELECT * FROM daily_challenges WHERE user_id = $1 AND date = $2",
            user_id, today,
        )
        enrich = await _deezer_enrich(request.app.ctx.session, row["artist"], row["title"])
        streak, longest = await _get_streak(pool, user_id)
        return json(_row_to_dict(row, ttl, enrich.get("preview", ""), streak, longest))

    # Check if user has at least one finished game
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id = $1 AND status = 'finished'",
        user_id,
    )
    if count == 0:
        return json({"locked": True, "reason": "no_games"})

    # Generate initial challenge + pre-warm reroll candidates in parallel
    songs = await _generate_challenges(request.app.ctx.session, pool, user_id, set(), count=MAX_REROLLS + 1)
    # Fallback to global Deezer charts when personalised generation finds nothing
    if not songs:
        songs = await _fallback_challenges(request.app.ctx.session, pool, user_id, set(), count=MAX_REROLLS + 1)
    if not songs:
        return json({"error": "unavailable"}, status=503)

    challenge  = songs[0]
    candidates = songs[1:]  # pre-generated reroll queue
    seed       = _daily_seed(today, challenge["artist"], challenge["title"])

    row = await pool.fetchrow(
        """
        INSERT INTO daily_challenges (user_id, date, artist, title, album, cover, candidates, seed)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (user_id, date) DO UPDATE SET artist = EXCLUDED.artist
        RETURNING *
        """,
        user_id, today,
        challenge["artist"], challenge["title"],
        challenge.get("album", ""), challenge.get("cover", ""),
        json_mod.dumps(candidates), seed,
    )
    streak, longest = await _get_streak(pool, user_id)
    return json(_row_to_dict(row, ttl, challenge.get("preview", ""), streak, longest))


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
    if row["abandoned_at"] is not None:
        raise SanicException("Challenge already abandoned", status_code=400)

    reroll_history = json_mod.loads(row["reroll_history"]) if row["reroll_history"] else []
    candidates     = json_mod.loads(row["candidates"])     if row.get("candidates") else []

    # Pop next pre-generated candidate (instant), or fall back to live/chart generation
    if candidates:
        challenge  = candidates.pop(0)
    else:
        exclude = {(e["artist"].lower(), e["title"].lower()) for e in reroll_history}
        exclude.add((row["artist"].lower(), row["title"].lower()))
        songs = await _generate_challenges(request.app.ctx.session, pool, user_id, exclude, count=1)
        if not songs:
            songs = await _fallback_challenges(request.app.ctx.session, pool, user_id, exclude, count=1)
        if not songs:
            raise SanicException("No candidates available", status_code=503)
        challenge = songs[0]

    reroll_history.append({"artist": row["artist"], "title": row["title"]})

    new_seed = _daily_seed(today, challenge["artist"], challenge["title"])
    updated = await pool.fetchrow(
        """
        UPDATE daily_challenges
        SET artist = $1, title = $2, album = $3, cover = $4,
            rerolls_used = rerolls_used + 1,
            reroll_history = $5::jsonb,
            candidates = $6::jsonb,
            seed = $7
        WHERE user_id = $8 AND date = $9
        RETURNING *
        """,
        challenge["artist"], challenge["title"],
        challenge.get("album", ""), challenge.get("cover", ""),
        json_mod.dumps(reroll_history),
        json_mod.dumps(candidates),
        new_seed,
        user_id, today,
    )
    return json(_row_to_dict(updated, ttl, challenge.get("preview", "")))


@daily_bp.post("/daily/abandon")
async def abandon_daily(request):
    payload = get_user_from_request(request)
    if not payload:
        raise SanicException("Unauthorized", status_code=401)

    user_id = payload["sub"]
    pool    = request.app.ctx.pool
    today   = _utc_today()
    ttl     = _seconds_until_midnight()

    row = await pool.fetchrow(
        "SELECT * FROM daily_challenges WHERE user_id=$1 AND date=$2", user_id, today
    )
    if not row:
        raise SanicException("No active challenge", status_code=404)
    if row["completed_at"] is not None:
        raise SanicException("Challenge already completed", status_code=400)
    if row["abandoned_at"] is not None:
        # Already abandoned — just return current state
        enrich = await _deezer_enrich(request.app.ctx.session, row["artist"], row["title"])
        return json(_row_to_dict(row, ttl, enrich.get("preview", "")))

    updated = await pool.fetchrow(
        "UPDATE daily_challenges SET abandoned_at=NOW() WHERE user_id=$1 AND date=$2 RETURNING *",
        user_id, today,
    )
    enrich = await _deezer_enrich(request.app.ctx.session, updated["artist"], updated["title"])
    return json(_row_to_dict(updated, ttl, enrich.get("preview", "")))


@daily_bp.get("/daily/yesterday")
async def get_yesterday(request):
    payload = get_user_from_request(request)
    if not payload:
        raise SanicException("Unauthorized", status_code=401)

    user_id = payload["sub"]
    pool = request.app.ctx.pool
    yesterday = _utc_today() - timedelta(days=1)

    row = await pool.fetchrow(
        "SELECT * FROM daily_challenges WHERE user_id = $1 AND date = $2",
        user_id, yesterday,
    )
    if not row:
        return json({"available": False})

    return json({
        "available": True,
        "artist":    row["artist"],
        "title":     row["title"],
        "album":     row["album"] or "",
        "cover":     row["cover"] or "",
        "completed": row["completed_at"] is not None,
    })
