import hashlib
from datetime import datetime, timedelta, timezone
from sanic import Blueprint, json
import aiohttp

daily_bp = Blueprint("daily", url_prefix="/api")

_cache: dict[str, tuple[str, dict]] = {}

CHART_URLS = {
    "global": "https://api.deezer.com/chart/0/tracks?limit=100",
    "fr":     "https://api.deezer.com/editorial/fr/charts?limit=100",
    "en":     "https://api.deezer.com/editorial/us/charts?limit=100",
    "es":     "https://api.deezer.com/editorial/es/charts?limit=100",
    "de":     "https://api.deezer.com/editorial/de/charts?limit=100",
    "it":     "https://api.deezer.com/editorial/it/charts?limit=100",
    "pt":     "https://api.deezer.com/editorial/br/charts?limit=100",
    "ja":     "https://api.deezer.com/editorial/jp/charts?limit=100",
}

LRCLIB_BASE = "https://lrclib.net/api"


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _day_seed(chart_key: str) -> int:
    today = _utc_today()
    return int(hashlib.md5(f"{today}-{chart_key}".encode()).hexdigest(), 16)


def _extract_tracks(data: dict, chart_key: str) -> list[dict]:
    if chart_key == "global":
        return data.get("data", [])
    return data.get("tracks", {}).get("data", [])


def _format_track(track: dict, rank: int, chart_key: str) -> dict:
    return {
        "artist":     track.get("artist", {}).get("name", ""),
        "title":      track.get("title_short") or track.get("title", ""),
        "album":      track.get("album", {}).get("title", ""),
        "cover":      track.get("album", {}).get("cover_medium", ""),
        "preview":    track.get("preview", ""),
        "chart_rank": track.get("position", rank),
        "chart":      chart_key,
        "date":       _utc_today(),
    }


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


async def _fetch_daily(session: aiohttp.ClientSession, chart_key: str) -> dict | None:
    today = _utc_today()

    if chart_key in _cache:
        cached_date, cached_data = _cache[chart_key]
        if cached_date == today:
            return cached_data

    url = CHART_URLS.get(chart_key, CHART_URLS["global"])
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status != 200:
                return None
            data = await r.json(content_type=None)
    except Exception as e:
        print(f"[daily] fetch error for {chart_key}: {e}")
        return None

    raw_tracks = _extract_tracks(data, chart_key)
    tracks = [
        t for t in raw_tracks
        if t.get("artist", {}).get("name") and (t.get("title_short") or t.get("title"))
    ]
    if not tracks:
        return None

    seed = _day_seed(chart_key)

    # Try up to 20 candidates to find one with lyrics available on lrclib
    for attempt in range(min(20, len(tracks))):
        idx = (seed + attempt) % len(tracks)
        candidate = tracks[idx]
        artist = candidate.get("artist", {}).get("name", "")
        title = candidate.get("title_short") or candidate.get("title", "")
        if await _has_lyrics(session, artist, title):
            result = _format_track(candidate, idx + 1, chart_key)
            _cache[chart_key] = (today, result)
            print(f"[daily] {chart_key}: found '{artist} - {title}' (attempt {attempt + 1})")
            return result

    # Fallback: return first valid track even without lyrics check
    idx = seed % len(tracks)
    result = _format_track(tracks[idx], idx + 1, chart_key)
    _cache[chart_key] = (today, result)
    print(f"[daily] {chart_key}: fallback to '{result['artist']} - {result['title']}' (no lyrics found in 20 tries)")
    return result


def _seconds_until_midnight() -> int:
    now = datetime.now(timezone.utc)
    midnight = datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1)
    return max(60, int((midnight - now).total_seconds()))


@daily_bp.get("/daily")
async def get_daily(request):
    chart = request.args.get("chart", "global")
    if chart not in CHART_URLS:
        chart = "global"

    result = await _fetch_daily(request.app.ctx.session, chart)
    if not result:
        return json({"error": "unavailable"}, status=503)

    ttl = _seconds_until_midnight()
    response = json(result)
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"
    return response
