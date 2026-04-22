import os
import re
import aiohttp
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from bs4 import BeautifulSoup
from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app.db import get_user_playlists, add_user_playlist, delete_user_playlist
from app.utils.jwt_utils import get_user_from_request

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

@playlists_bp.delete("/<playlist_id>")
async def delete_playlist(request, playlist_id: str):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    success = await delete_user_playlist(request.app.ctx.pool, user["sub"], playlist_id)
    if not success:
        raise SanicException("Playlist non trouvée", status_code=404)
        
    return json({"ok": True})
