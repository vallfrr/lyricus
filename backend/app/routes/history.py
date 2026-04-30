from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app import db
from app.utils.jwt_utils import get_user_from_request
from app.routes.songs import deezer_enrich, lrclib_get
from app.utils.text import mask_lyrics
from app.routes.lyrics import _sign_answers
import json as _json

history_bp = Blueprint("history", url_prefix="/api/history")


@history_bp.post("/")
async def create_session(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    body = request.json or {}
    required = ["artist", "title", "difficulty", "mode", "score_correct", "score_total"]
    for field in required:
        if field not in body:
            raise SanicException(f"Missing field: {field}", status_code=400)

    # Auto-fetch cover from Deezer if not provided
    if not body.get("cover"):
        extra = await deezer_enrich(request.app.ctx.session, body["artist"], body["title"])
        if extra.get("cover"):
            body = {**body, "cover": extra["cover"]}

    # Compute points gained BEFORE saving (session not yet in 'finished' state)
    song_best, points_gained = await db.compute_points_gained(
        request.app.ctx.pool, user["sub"],
        body["artist"], body["title"], body["difficulty"],
        body["score_correct"], body["score_total"],
        body.get("unique_correct"), body.get("unique_total"),
    )

    session_id = await db.save_game_session(request.app.ctx.pool, user["sub"], body)
    return json({"id": session_id, "points_gained": points_gained, "song_best": song_best}, status=201)


@history_bp.get("/")
async def list_sessions(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)

    history = await db.get_user_history(request.app.ctx.pool, user["sub"])
    return json(history)


@history_bp.post("/start")
async def start_session(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    body = request.json or {}
    
    if not body.get("cover") and body.get("artist") and body.get("title"):
        extra = await deezer_enrich(request.app.ctx.session, body["artist"], body["title"])
        if extra.get("cover"):
            body = {**body, "cover": extra["cover"]}

    session_id = await db.start_game_session(request.app.ctx.pool, user["sub"], body)
    return json({"id": session_id}, status=201)


@history_bp.get("/unfinished")
async def get_unfinished(request):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    history = await db.get_unfinished_sessions(request.app.ctx.pool, user["sub"])
    return json(history)


@history_bp.get("/<session_id:uuid>")
async def get_session(request, session_id):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    session = await db.get_game_session(request.app.ctx.pool, str(session_id), user["sub"])
    if not session:
        raise SanicException("Not Found", status_code=404)

    artist = session["artist"]
    title = session["title"]
    album = session["album"]
    difficulty = session["difficulty"]
    seed = session["seed"]
    
    data = await lrclib_get(request.app.ctx.session, artist, title, album)
    if not data or not data.get("plainLyrics"):
        raise SanicException("Lyrics unavailable for resume", status_code=404)
        
    plain = data["plainLyrics"]
    tokens = mask_lyrics(plain, difficulty, seed=seed)
    
    answers = {}
    frontend_tokens = []
    blank_id = 0
    for token in tokens:
        if token["type"] == "blank":
            answers[str(blank_id)] = token["value"]
            frontend_tokens.append({"type": "blank", "id": blank_id})
            blank_id += 1
        else:
            frontend_tokens.append(token)
            
    return json({
        "game_tokens": frontend_tokens,
        "game_answers": answers,
        "game_answer_token": _sign_answers(answers),
        "artist": artist,
        "title": title,
        "album": album,
        "seed": seed,
        "details": session.get("details")
    })

@history_bp.patch("/<session_id:uuid>/progress")
async def update_progress(request, session_id):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    body = request.json or {}
    details = _json.dumps(body) if body else None
    await db.update_db_progress(request.app.ctx.pool, str(session_id), user["sub"], details)
    return json({"success": True})

@history_bp.patch("/<session_id:uuid>")
async def finish_session(request, session_id):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    body = request.json or {}
    pool = request.app.ctx.pool

    # Fetch artist/title/difficulty from the existing session (still 'playing')
    # so points_gained can be computed before marking as finished
    points_gained = 0
    row = await pool.fetchrow(
        "SELECT artist, title, difficulty FROM game_sessions WHERE id=$1 AND user_id=$2",
        str(session_id), user["sub"],
    )
    song_best = 0
    if row:
        song_best, points_gained = await db.compute_points_gained(
            pool, user["sub"],
            row["artist"], row["title"], row["difficulty"],
            body.get("score_correct", 0), body.get("score_total", 0),
            body.get("unique_correct"), body.get("unique_total"),
        )

    await db.finish_db_session(pool, str(session_id), user["sub"], body)
    return json({"success": True, "points_gained": points_gained, "song_best": song_best})


@history_bp.delete("/<session_id:uuid>")
async def discard_session(request, session_id):
    user = get_user_from_request(request)
    if not user:
        raise SanicException("Unauthorized", status_code=401)
    await db.delete_game_session(request.app.ctx.pool, str(session_id), user["sub"])
    return json({"success": True})
