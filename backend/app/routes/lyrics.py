import os
import hmac
import hashlib
import json as _json
import base64
import random
from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app.utils.text import mask_lyrics, check_answer
from app.utils.ratelimit import is_rate_limited, rate_limit_response
from app.routes.songs import lrclib_get

lyrics_bp = Blueprint("lyrics", url_prefix="/api")


def _secret() -> bytes:
    return os.environ.get("JWT_SECRET", "change-me-in-prod").encode()


def _sign_answers(answers: dict) -> str:
    payload = _json.dumps(answers, sort_keys=True)
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    b64 = base64.urlsafe_b64encode(payload.encode()).decode()
    return f"{b64}.{sig}"


def _verify_answers(token: str) -> dict | None:
    try:
        b64, sig = token.rsplit(".", 1)
        payload = base64.urlsafe_b64decode(b64 + "==").decode()
        expected = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        return _json.loads(payload)
    except Exception:
        return None


@lyrics_bp.get("/lyrics")
async def get_lyrics(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="lyrics", max_req=30, window=60):
        return rate_limit_response()

    artist     = request.args.get("artist", "").strip()
    title      = request.args.get("title", "").strip()
    album      = request.args.get("album", "").strip()
    difficulty = request.args.get("difficulty", "medium")

    if not artist or not title:
        raise SanicException("artist and title are required", status_code=400)

    data = await lrclib_get(request.app.ctx.session, artist, title, album)
    if not data:
        raise SanicException("Lyrics not found", status_code=404)

    plain = data.get("plainLyrics", "")
    if not plain:
        raise SanicException("No lyrics available", status_code=404)

    seed_arg = request.args.get("seed")
    if seed_arg is not None:
        try:
            seed = int(seed_arg)
        except ValueError:
            seed = random.randint(0, 999999999)
    else:
        seed = random.randint(0, 999999999)

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
        "seed":         seed,
        "tokens":       frontend_tokens,
        "answers":      answers,           # needed by FlowGame for client-side reveal
        "answer_token": _sign_answers(answers),   # used by LyricsGame for secure check
        "song": {
            "artist": data.get("artistName", artist),
            "title":  data.get("trackName", title),
            "album":  data.get("albumName", album),
        },
    })


@lyrics_bp.post("/check")
async def check_answers(request):
    body = request.json or {}
    user_answers = body.get("answers", {})
    token        = body.get("token", "")

    correct_answers = _verify_answers(token)
    if correct_answers is None:
        return json({"error": "token invalide"}, status=400)

    results = {}
    correct_count = 0
    for key, expected in correct_answers.items():
        user_input = user_answers.get(key, "")
        is_correct = bool(user_input.strip()) and check_answer(user_input, expected)
        results[key] = is_correct
        if is_correct:
            correct_count += 1

    return json({
        "results":         results,
        "score":           {"correct": correct_count, "total": len(correct_answers)},
        "correct_answers": correct_answers,   # returned for display after submission
    })
