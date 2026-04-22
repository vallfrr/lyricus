import asyncio
import random
import re
from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app.utils import cache as cache_store
from app.utils.ratelimit import is_rate_limited, rate_limit_response

_FEAT_RE = re.compile(r'\s+(?:feat\.?|ft\.?|with|&)\s+.*', re.IGNORECASE)

def _main_artist(name: str) -> str:
    """Strip featured artists: 'Daft Punk feat. Pharrell' → 'Daft Punk'."""
    return _FEAT_RE.sub("", name).strip()

songs_bp = Blueprint("songs", url_prefix="/api")

DEEZER_BASE = "https://api.deezer.com"
LRCLIB_BASE = "https://lrclib.net/api"


async def lrclib_get(session, artist: str, title: str, album: str = "") -> dict | None:
    """Fetch lyrics from lrclib with caching."""
    key = f"lrc:{artist}:{title}:{album}".lower()
    cached = cache_store.get(key)
    if cached is not None:
        return cached

    params = {"artist_name": artist, "track_name": title}
    if album:
        params["album_name"] = album

    try:
        async with session.get(f"{LRCLIB_BASE}/get", params=params) as resp:
            if resp.status == 200:
                data = await resp.json()
                if data.get("plainLyrics"):
                    cache_store.set(key, data)
                    return data
    except Exception:
        pass
    return None


def _slug(s: str) -> str:
    """Strip punctuation/accents for fuzzy matching: 'Do I Wanna Know?' → 'do i wanna know'"""
    import unicodedata
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^\w\s]", "", s).strip()


async def deezer_enrich(session, artist: str, title: str) -> dict:
    """Fetch cover + preview URL from Deezer search.
    Deezer 30s preview URLs (cdns-preview-*.dzcdn.net) are publicly accessible
    from browsers — no auth tokens, no IP binding, unlike full-track CDN URLs."""
    cache_key = f"dz_enrich:{artist.lower()}:{title.lower()}"
    cached = cache_store.get(cache_key)
    if cached is not None:
        return cached

    try:
        async with session.get(
            f"{DEEZER_BASE}/search",
            params={"q": f"{artist} {title}", "limit": "10"},
        ) as r:
            if r.status != 200:
                return {}
            data = await r.json()
    except Exception:
        return {}

    t_slug = _slug(title)
    a_slug = _slug(_FEAT_RE.sub("", artist))
    results = data.get("data", [])

    best = None
    for result in results:
        found_title  = _slug(result.get("title_short") or result.get("title", ""))
        found_artist = _slug(result.get("artist", {}).get("name", ""))
        title_ok  = t_slug in found_title or found_title in t_slug
        artist_ok = a_slug in found_artist or found_artist in a_slug
        if title_ok and artist_ok:
            best = result
            break

    # Fallback: title match only (artist name stored in DB may differ slightly)
    if not best:
        for result in results:
            found_title = _slug(result.get("title_short") or result.get("title", ""))
            if t_slug in found_title or found_title in t_slug:
                best = result
                break

    if best:
        extra = {
            "cover":   best.get("album", {}).get("cover_medium", ""),
            "preview": best.get("preview", ""),
        }
        cache_store.set(cache_key, extra)
        return extra

    # Don't cache misses — let the backfill retry on next startup
    return {}


@songs_bp.get("/genres")
async def get_genres(request):
    """Return available music genres from Deezer."""
    cached = cache_store.get("deezer:genres")
    if cached:
        return json(cached)

    session = request.app.ctx.session
    async with session.get(f"{DEEZER_BASE}/genre") as resp:
        if resp.status != 200:
            raise SanicException("Failed to fetch genres", status_code=502)
        data = await resp.json()

    genres = [
        {"id": g["id"], "name": g["name"], "picture": g.get("picture_medium", "")}
        for g in data.get("data", [])
        if g["id"] != 0
    ]
    cache_store.set("deezer:genres", genres)
    response = json(genres)
    response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=3600"
    return response


@songs_bp.get("/random")
async def get_random_songs(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="random", max_req=15, window=60):
        return rate_limit_response()
    """
    Get up to 5 random songs with lyrics for a given genre.
    Query params: genre_id (int), count (int, default 5)
    Returns: list of { artist, title, album, duration, cover, preview }
    """
    genre_id = request.args.get("genre_id", "0")
    count = min(int(request.args.get("count", "5")), 10)
    session = request.app.ctx.session

    # Fetch Deezer chart (cached)
    chart_key = f"deezer:chart:{genre_id}"
    tracks = cache_store.get(chart_key)
    if tracks is None:
        async with session.get(f"{DEEZER_BASE}/chart/{genre_id}/tracks?limit=100") as resp:
            if resp.status != 200:
                raise SanicException("Failed to fetch chart", status_code=502)
            data = await resp.json()
        tracks = data.get("data", [])
        if tracks:
            cache_store.set(chart_key, tracks)

    if not tracks:
        raise SanicException("No tracks found for this genre", status_code=404)

    pool = random.sample(tracks, min(30, len(tracks)))

    results = []

    async def check_track(track):
        artist = track["artist"]["name"]
        title  = track["title_short"]
        album  = track.get("album", {}).get("title", "")
        if not await lrclib_get(session, artist, title, album):
            return None
        return {
            "artist":   artist,
            "title":    title,
            "album":    album,
            "duration": track.get("duration", 0),
            "cover":    track.get("album", {}).get("cover_medium", ""),
            "preview":  track.get("preview", ""),
        }

    for i in range(0, len(pool), 10):
        batch = pool[i:i + 10]
        batch_results = await asyncio.gather(*[check_track(t) for t in batch])
        for r in batch_results:
            if r and len(results) < count:
                results.append(r)
        if len(results) >= count:
            break

    if not results:
        raise SanicException("Could not find songs with lyrics for this genre", status_code=404)

    return json(results)


@songs_bp.get("/search")
async def search_songs(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="search", max_req=40, window=60):
        return rate_limit_response()
    """
    Search songs via lrclib, enriched with Deezer cover + preview.
    Query params: q (string)
    Returns: list of { artist, title, album, cover, preview }
    """
    query = request.args.get("q", "").strip()
    if not query:
        return json([])

    cache_key = f"search:{query.lower()}"
    cached = cache_store.get(cache_key)
    if cached is not None:
        return json(cached)

    session = request.app.ctx.session
    async with session.get(f"{LRCLIB_BASE}/search", params={"q": query}) as resp:
        if resp.status != 200:
            return json([])
        data = await resp.json()

    # Deduplicate by exact (artist, title) — first pass
    seen: set[tuple[str, str]] = set()
    base_results = []
    for item in (data if isinstance(data, list) else []):
        if not item.get("plainLyrics"):
            continue
        key = (item.get("artistName", "").lower().strip(), item.get("trackName", "").lower().strip())
        if key in seen:
            continue
        seen.add(key)
        base_results.append({
            "artist":   item.get("artistName", ""),
            "title":    item.get("trackName", ""),
            "album":    item.get("albumName", ""),
            "duration": item.get("duration", 0),
        })
        if len(base_results) >= 15:
            break

    async def enrich(song):
        extra = await deezer_enrich(session, song["artist"], song["title"])
        return {**song, **extra}

    enriched = list(await asyncio.gather(*[enrich(s) for s in base_results]))

    # Second pass: deduplicate by preview URL — Deezer returns stable preview
    # URLs per track, so this reliably catches feat./artist-variant dupes
    seen_previews: set[str] = set()
    results = []
    for r in enriched:
        preview = r.get("preview", "")
        if preview:
            if preview in seen_previews:
                continue
            seen_previews.add(preview)
        results.append(r)

    cache_store.set(cache_key, results)
    return json(results)


@songs_bp.get("/artist")
async def get_artist_page(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="artist", max_req=20, window=60):
        return rate_limit_response()

    name = request.args.get("name", "").strip()
    if not name:
        return json({"error": "missing name"}, status=400)

    # Strip featured artists before searching (e.g. "Daft Punk feat. Pharrell" → "Daft Punk")
    search_name = _main_artist(name)

    cache_key = f"artist_page:{search_name.lower()}"
    cached = cache_store.get(cache_key)
    if cached:
        return json(cached)

    session = request.app.ctx.session

    async with session.get(f"{DEEZER_BASE}/search/artist", params={"q": search_name, "limit": "1"}) as r:
        if r.status != 200:
            return json({"error": "not found"}, status=404)
        data = await r.json()

    artists = data.get("data", [])
    if not artists:
        return json({"error": "not found"}, status=404)
    artist = artists[0]
    artist_id = artist["id"]
    artist_name = artist["name"]

    async with session.get(f"{DEEZER_BASE}/artist/{artist_id}/top?limit=50") as r:
        if r.status != 200:
            return json({"error": "no tracks"}, status=404)
        tracks_data = await r.json()

    tracks = tracks_data.get("data", [])

    async def check_track(track):
        title = track.get("title_short", track.get("title", ""))
        album = track.get("album", {}).get("title", "")
        if not await lrclib_get(session, artist_name, title, album):
            return None
        return {
            "artist":  artist_name,
            "title":   title,
            "album":   album,
            "cover":   track.get("album", {}).get("cover_medium", ""),
            "preview": track.get("preview", ""),
            "rank":    track.get("position", 0),
        }

    results = []
    for i in range(0, len(tracks), 10):
        batch = tracks[i:i + 10]
        batch_results = await asyncio.gather(*[check_track(t) for t in batch])
        results.extend([r for r in batch_results if r])
        if len(results) >= 20:
            break

    result = {
        "id":      artist_id,
        "name":    artist_name,
        "picture": artist.get("picture_medium", ""),
        "fans":    artist.get("nb_fan", 0),
        "tracks":  results[:20],
    }

    cache_store.set(cache_key, result)
    response = json(result)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response
