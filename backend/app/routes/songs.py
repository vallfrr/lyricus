import asyncio
import random
import re
import aiohttp
from sanic import Blueprint, json, HTTPResponse
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
    """Fetch lyrics from lrclib with caching.
    First tries exact GET (artist_name + track_name), then falls back to fuzzy search
    so that slight spelling/casing differences (e.g. from Last.fm) still resolve."""
    key = f"lrc:{artist}:{title}:{album}".lower()
    cached = cache_store.get(key)
    if cached is not None:
        return cached

    params = {"artist_name": artist, "track_name": title}
    if album:
        params["album_name"] = album

    # 1) Exact match
    try:
        async with session.get(
            f"{LRCLIB_BASE}/get",
            params=params,
            timeout=aiohttp.ClientTimeout(total=12),
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                if data.get("plainLyrics"):
                    cache_store.set(key, data)
                    return data
    except Exception:
        pass

    # 2) Fuzzy search fallback — handles casing/accent/spelling differences from Last.fm etc.
    try:
        import unicodedata as _ud

        def _norm(s):
            s = _ud.normalize("NFKD", s.lower())
            s = "".join(c for c in s if not _ud.combining(c))
            return re.sub(r"[^\w\s]", "", s).strip()

        artist_n = _norm(artist)
        title_n  = _norm(title)

        async with session.get(
            f"{LRCLIB_BASE}/search",
            params={"q": f"{artist} {title}"},
            timeout=aiohttp.ClientTimeout(total=12),
        ) as resp:
            if resp.status == 200:
                results = await resp.json()
                for r in (results or [])[:8]:
                    if not r.get("plainLyrics"):
                        continue
                    r_artist = _norm(r.get("artistName", ""))
                    r_title  = _norm(r.get("trackName", ""))
                    # Accept if both artist and title are close enough
                    if (artist_n in r_artist or r_artist in artist_n) and \
                       (title_n  in r_title  or r_title  in title_n):
                        cache_store.set(key, r)
                        return r
    except Exception:
        pass

    return None


def _slug(s: str) -> str:
    """Strip punctuation/accents for fuzzy matching: 'Do I Wanna Know?' → 'do i wanna know'"""
    import unicodedata
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^\w\s]", "", s).strip()


# Strips parenthetical/bracketed metadata tags from track titles:
# (Explicit), (Deluxe), (Live at ...), (feat. X), (Radio Edit), (Remastered), etc.
_TITLE_JUNK_RE = re.compile(
    r'''\s*[\(\[]\s*(?:
        feat\.?|ft\.?|with|prod\.?|prod\s+by   # featuring / production credits
        |explicit|clean|censored                 # content rating
        |deluxe(?:\s+edition)?|bonus\s+track    # release variant
        |live(?:\s+at|\s+from|\s+version)?      # live recordings
        |acoustic(?:\s+version)?                # acoustic
        |radio\s*edit                            # radio edit
        |official(?:\s+(?:video|audio|music\s+video))?  # official video/audio
        |lyric[s]?(?:\s+video)?                 # lyric video
        |instrumental                            # instrumental
        |remaster(?:ed)?(?:\s+\d{4})?           # remastered
        |extended(?:\s+(?:version|mix))?        # extended
        |(?:\d{4}\s+)?remaster                  # year remaster
        |original\s+(?:version|mix|recording)  # original version
        |anniversary\s+edition                  # anniversary
        |single\s+version                       # single version
        |from\s+.+                              # from "Soundtrack"
        |mono(?:\s+version)?|stereo             # mono/stereo
    )[^\)\]]*[\)\]]''',
    re.IGNORECASE | re.VERBOSE,
)

async def deezer_enrich(session, artist: str, title: str) -> dict:
    """Fetch cover + preview URL from Deezer search."""
    cache_key = f"dz_enrich:{artist.lower()}:{title.lower()}"
    cached = cache_store.get(cache_key)
    if cached is not None:
        return cached

    # Strip featuring from artist name
    clean_artist = _FEAT_RE.sub("", artist).strip()
    # Strip all metadata tags from title: (Explicit), (Live), (feat. X), etc.
    clean_title = _TITLE_JUNK_RE.sub("", title).strip()
    # Also handle bare feat. without parentheses: "Title feat. X" → "Title"
    clean_title = re.sub(r'\s+(?:feat\.?|ft\.?)\s+.+$', '', clean_title, flags=re.IGNORECASE).strip()

    print(f"[enrich] '{artist}' – '{title}'  =>  artist='{clean_artist}'  title='{clean_title}'")

    async def _search(q: str, limit: int) -> list:
        try:
            async with session.get(
                f"{DEEZER_BASE}/search",
                params={"q": q, "limit": str(limit)},
                timeout=aiohttp.ClientTimeout(total=6),
            ) as r:
                if r.status != 200:
                    print(f"[enrich] Deezer HTTP {r.status} for q={q!r}")
                    return []
                data = await r.json(content_type=None)
                return data.get("data", [])
        except Exception as e:
            print(f"[enrich] request error: {e}")
            return []

    t_slug = _slug(clean_title)
    a_slug = _slug(clean_artist)
    # Fallback slug: strip ALL parentheses/brackets content (catches edge cases the regex missed)
    t_slug_bare = _slug(re.sub(r'\s*[\(\[].*?[\)\]]', '', clean_title))

    def _best_match(results: list) -> dict | None:
        # Pass 1: both title + artist match (try cleaned slug, then bare slug)
        for result in results:
            found_title  = _slug(result.get("title_short") or result.get("title", ""))
            found_artist = _slug(result.get("artist", {}).get("name", ""))
            artist_ok = a_slug in found_artist or found_artist in a_slug
            if not artist_ok:
                continue
            if t_slug in found_title or found_title in t_slug:
                return result
            if t_slug_bare and (t_slug_bare in found_title or found_title in t_slug_bare):
                return result
        # Pass 2: title only — artist name may differ across platforms
        for result in results:
            found_title = _slug(result.get("title_short") or result.get("title", ""))
            if t_slug in found_title or found_title in t_slug:
                return result
            if t_slug_bare and (t_slug_bare in found_title or found_title in t_slug_bare):
                return result
        return None

    best = None

    # 1) Strict search using Deezer's advanced syntax
    strict = await _search(f'artist:"{clean_artist}" track:"{clean_title}"', 10)
    print(f"[enrich] strict results: {len(strict)}")
    if strict:
        best = _best_match(strict)

    # 2) Loose fallback — always try if strict found nothing useful
    if not best:
        loose = await _search(f"{clean_artist} {clean_title}", 25)
        print(f"[enrich] loose results: {len(loose)}")
        if loose:
            best = _best_match(loose)

    # 3) Title-only fallback — some artists have different spellings across platforms
    if not best:
        title_only = await _search(clean_title, 15)
        print(f"[enrich] title-only results: {len(title_only)}")
        if title_only:
            best = _best_match(title_only)

    if best:
        preview = best.get("preview", "")
        print(f"[enrich] FOUND '{best.get('title_short')}' by '{best.get('artist',{}).get('name')}' — preview={'YES' if preview else 'EMPTY'}")
        extra = {
            "cover":   best.get("album", {}).get("cover_medium", ""),
            "preview": preview,
        }
        # Deezer hdnea tokens expire after ~2h — cache for 20 min to stay safe
        cache_store.set(cache_key, extra, ttl=1200)
        return extra

    print(f"[enrich] NOT FOUND for '{clean_title}' by '{clean_artist}' (t_slug={t_slug!r}, a_slug={a_slug!r})")
    # Don't cache misses — let it retry next time
    return {}


@songs_bp.get("/preview")
async def proxy_preview(request):
    """Proxy Deezer preview audio through the backend.
    Deezer CDN tokens (hdnea) are bound to the requesting IP.
    Since the backend fetched the URL, only requests from this server's IP work —
    the browser must go through us."""
    url = request.args.get("url", "").strip()
    if not url or "dzcdn.net" not in url:
        raise SanicException("Invalid preview URL", status_code=400)

    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="preview", max_req=120, window=60):
        return rate_limit_response()

    # Akamai CDN validates Referer + Origin — spoof deezer.com to pass the check
    req_headers = {
        "Referer":    "https://www.deezer.com/",
        "Origin":     "https://www.deezer.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
    range_hdr = request.headers.get("Range")
    if range_hdr:
        req_headers["Range"] = range_hdr

    session = request.app.ctx.session
    try:
        async with session.get(
            url,
            headers=req_headers,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            body = await resp.read()
            content_type = resp.headers.get("Content-Type", "audio/mpeg")
            print(f"[preview proxy] {resp.status} {content_type} {len(body)}b for {url[:60]}...")
            resp_headers = {
                "Cache-Control": "public, max-age=1800",
                "Access-Control-Allow-Origin": "*",
                "Accept-Ranges": "bytes",
            }
            if "Content-Range" in resp.headers:
                resp_headers["Content-Range"] = resp.headers["Content-Range"]
            return HTTPResponse(
                body=body,
                status=resp.status,
                content_type=content_type,
                headers=resp_headers,
            )
    except Exception as e:
        print(f"[preview proxy] error: {e}")
        raise SanicException("Preview unavailable", status_code=502)


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
