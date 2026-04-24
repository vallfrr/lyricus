import asyncio
import os
import random
import re
import aiohttp
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from bs4 import BeautifulSoup
from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app.db import get_user_playlists, add_user_playlist, delete_user_playlist
from app.utils.jwt_utils import get_user_from_request
from app.routes.songs import deezer_enrich

playlists_bp = Blueprint("playlists", url_prefix="/api/playlists")

async def get_spotify_playlist_info(url: str):
    match = re.search(r"spotify\.com.*?/playlist/([a-zA-Z0-9]+)", url)
    if not match:
        raise ValueError("Invalid Spotify playlist URL")
    playlist_id = match.group(1)
    
    # We use sync spotipy because the auth flow is quick, but in async env 
    # we should ideally run it in an executor or just let it block briefly.
    try:
        sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(
            client_id=os.environ.get("SPOTIFY_CLIENT_ID"),
            client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET")
        ))
        playlist = sp.playlist(playlist_id, fields="name,images,tracks.total")
        name = playlist.get("name", "Unknown Playlist")
        cover = playlist["images"][0]["url"] if playlist.get("images") else ""
        track_count = playlist["tracks"]["total"] if "tracks" in playlist else 0
        return {"platform": "spotify", "name": name, "cover": cover, "track_count": track_count}
    except Exception as e:
        print(f"Spotify error: {e}")
        raise ValueError("Could not fetch Spotify playlist data. Check credentials and URL.")

async def get_deezer_playlist_info(url: str, session: aiohttp.ClientSession):
    match = re.search(r"deezer\.com.*?/playlist/(\d+)", url)
    if not match:
        raise ValueError("Invalid Deezer playlist URL")
    playlist_id = match.group(1)
    
    async with session.get(f"https://api.deezer.com/playlist/{playlist_id}") as resp:
        if resp.status != 200:
            raise ValueError("Deezer playlist not found or private")
        data = await resp.json()
        if "error" in data:
            raise ValueError(f"Deezer error: {data['error'].get('message')}")
            
        return {
            "platform": "deezer",
            "name": data.get("title", "Unknown Playlist"),
            "cover": data.get("picture_medium") or data.get("picture", ""),
            "track_count": data.get("nb_tracks", 0)
        }

async def get_soundcloud_playlist_info(url: str, session: aiohttp.ClientSession):
    async with session.get(url) as resp:
        if resp.status != 200:
            raise ValueError("SoundCloud playlist not found")
        html = await resp.text()
        
    soup = BeautifulSoup(html, "html.parser")
    title_meta = soup.find("meta", property="og:title")
    image_meta = soup.find("meta", property="og:image")
    
    name = title_meta["content"] if title_meta else "SoundCloud Playlist"
    cover = image_meta["content"] if image_meta else ""
    
    # Track count is harder to parse reliably without API, we look for something like 'XX tracks'
    track_count = 0
    # Soundcloud includes track count in a meta tag sometimes, e.g., <meta property="soundcloud:track_count" content="..."/>
    track_count_meta = soup.find("meta", property="soundcloud:track_count")
    if track_count_meta:
        try:
            track_count = int(track_count_meta["content"])
        except ValueError:
            pass
            
    return {
        "platform": "soundcloud",
        "name": name.replace(" - playlist by ", "").strip(),
        "cover": cover,
        "track_count": track_count
    }

@playlists_bp.get("/")
async def list_playlists(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    playlists = await get_user_playlists(request.app.ctx.pool, user["sub"])
    return json(playlists)

@playlists_bp.post("/")
async def add_playlist(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    body = request.json or {}
    url = body.get("url", "").strip()
    if not url:
        raise SanicException("URL is required", status_code=400)

    # Check max playlists
    existing = await get_user_playlists(request.app.ctx.pool, user["sub"])
    if len(existing) >= 5:
        raise SanicException("Tu ne peux ajouter que 5 playlists maximum.", status_code=400)

    # Detect platform and fetch metadata
    try:
        session = request.app.ctx.session
        if "spotify.com" in url:
            info = await get_spotify_playlist_info(url)
        elif "deezer.com" in url:
            info = await get_deezer_playlist_info(url, session)
        elif "soundcloud.com" in url:
            info = await get_soundcloud_playlist_info(url, session)
        else:
            raise SanicException("Plateforme non supportée. Utilise Spotify, Deezer ou SoundCloud.", status_code=400)
    except Exception as e:
        raise SanicException(str(e), status_code=400)

    try:
        new_playlist = await add_user_playlist(
            request.app.ctx.pool,
            user["sub"],
            info["platform"],
            url,
            info["name"],
            info["cover"],
            info["track_count"]
        )
        return json(new_playlist, status=201)
    except Exception as e:
        # Might fail if URL is already added (UNIQUE constraint)
        raise SanicException("Erreur lors de l'ajout de la playlist (peut-être existe-t-elle déjà ?)", status_code=400)

def _fetch_spotify_tracks(url: str, offset: int, limit: int) -> list[dict]:
    """Fetch a batch of tracks from a Spotify playlist at a given offset (sync, run via to_thread)."""
    match = re.search(r"spotify\.com.*?/playlist/([a-zA-Z0-9]+)", url)
    if not match:
        return []
    playlist_id = match.group(1)
    try:
        sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(
            client_id=os.environ.get("SPOTIFY_CLIENT_ID"),
            client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET"),
        ))
        result = sp.playlist_items(
            playlist_id,
            offset=offset,
            limit=limit,
            fields="items(track(name,artists,album(name,images)))",
        )
        tracks = []
        for item in (result.get("items") or []):
            track = item.get("track")
            if not track or not track.get("name"):
                continue
            artists = track.get("artists") or []
            artist = artists[0]["name"] if artists else ""
            if not artist:
                continue
            images = track.get("album", {}).get("images") or []
            cover = images[0]["url"] if images else ""
            tracks.append({
                "artist": artist,
                "title": track["name"],
                "album": track.get("album", {}).get("name", ""),
                "cover": cover,
                "preview": "",
            })
        return tracks
    except Exception:
        return []


async def _fetch_deezer_tracks(url: str, offset: int, limit: int, session: aiohttp.ClientSession) -> list[dict]:
    """Fetch a batch of tracks from a Deezer playlist at a given offset."""
    match = re.search(r"deezer\.com.*?/playlist/(\d+)", url)
    if not match:
        return []
    playlist_id = match.group(1)
    try:
        async with session.get(
            f"https://api.deezer.com/playlist/{playlist_id}/tracks",
            params={"index": offset, "limit": limit},
            timeout=aiohttp.ClientTimeout(total=8),
        ) as r:
            if r.status != 200:
                return []
            data = await r.json(content_type=None)
            tracks = []
            for t in (data.get("data") or []):
                artist = t.get("artist", {}).get("name", "")
                title = t.get("title_short") or t.get("title", "")
                if not artist or not title:
                    continue
                tracks.append({
                    "artist": artist,
                    "title": title,
                    "album": t.get("album", {}).get("title", ""),
                    "cover": t.get("album", {}).get("cover_medium", ""),
                    "preview": t.get("preview", ""),
                })
            return tracks
    except Exception:
        return []


@playlists_bp.get("/tracks")
async def get_playlist_tracks(request):
    """Return a shuffled sample of tracks across all user playlists.
    Used by the frontend to populate the sessionStorage cache for random picking."""
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    playlists = await get_user_playlists(request.app.ctx.pool, user["sub"])
    if not playlists:
        return json([])

    session = request.app.ctx.session
    BATCH = 30  # tracks to fetch per playlist

    async def fetch_for_playlist(pl):
        track_count = pl.get("track_count") or 0
        if track_count == 0:
            return []
        max_offset = max(0, track_count - BATCH)
        offset = random.randint(0, max_offset)
        platform = pl["platform"]
        if platform == "spotify":
            # spotipy is sync — run in thread executor to avoid blocking the event loop
            return await asyncio.to_thread(_fetch_spotify_tracks, pl["url"], offset, BATCH)
        elif platform == "deezer":
            return await _fetch_deezer_tracks(pl["url"], offset, BATCH, session)
        return []

    results_per_playlist = await asyncio.gather(*[fetch_for_playlist(pl) for pl in playlists])

    all_tracks: list[dict] = []
    for tracks in results_per_playlist:
        all_tracks.extend(tracks)

    if not all_tracks:
        return json([])

    random.shuffle(all_tracks)

    # Enrich Spotify tracks (no preview/cover from API) with Deezer in parallel
    async def enrich(track):
        if not track.get("preview") or not track.get("cover"):
            extra = await deezer_enrich(session, track["artist"], track["title"])
            return {**track, **{k: v for k, v in extra.items() if not track.get(k)}}
        return track

    enriched = await asyncio.gather(*[enrich(t) for t in all_tracks])
    return json(list(enriched))


@playlists_bp.delete("/<playlist_id>")
async def delete_playlist(request, playlist_id: str):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    success = await delete_user_playlist(request.app.ctx.pool, user["sub"], playlist_id)
    if not success:
        raise SanicException("Playlist non trouvée", status_code=404)
        
    return json({"ok": True})
