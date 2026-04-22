import os
import re
import urllib.parse
import aiohttp
from sanic import Blueprint, json, redirect
from app.db import (
    get_or_create_user, update_username, get_user_by_id,
    register_user, get_user_by_email, verify_password, delete_user,
    get_user_by_google_id, link_google_to_user,
    get_user_by_discord_id, get_or_create_user_discord, link_discord_to_user,
)
from app.utils.jwt_utils import encode, decode, get_user_from_request
from app.utils.ratelimit import is_rate_limited, rate_limit_response

auth_bp = Blueprint("auth", url_prefix="/api/auth")

GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

DISCORD_AUTH_URL    = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN_URL   = "https://discord.com/api/oauth2/token"
DISCORD_API_URL     = "https://discord.com/api/users/@me"


USERNAME_RE = re.compile(r'^[a-zA-Z0-9_\-\.]{2,20}$')
EMAIL_RE    = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
PASSWORD_MIN_LEN = 8


def _validate_password(pw: str) -> str | None:
    if len(pw) < PASSWORD_MIN_LEN:
        return f"mot de passe trop court (min {PASSWORD_MIN_LEN} caractères)"
    if not any(c.isupper() for c in pw):
        return "doit contenir au moins une majuscule"
    if not any(c.islower() for c in pw):
        return "doit contenir au moins une minuscule"
    if not any(c.isdigit() for c in pw):
        return "doit contenir au moins un chiffre"
    return None


def _redirect_uri(provider: str) -> str:
    defaults = {
        "google":   "http://localhost:3000/api/auth/callback",
        "discord":  "http://localhost:3000/api/auth/discord/callback",
        "apple":    "http://localhost:3000/api/auth/apple/callback",
        "facebook": "http://localhost:3000/api/auth/facebook/callback",
    }
    env_key = f"{provider.upper()}_REDIRECT_URI"
    return os.environ.get(env_key, defaults[provider])


def _set_jwt_cookie(response, user):
    token = encode({"sub": str(user["id"]), "email": user["email"], "name": user.get("name") or ""})
    response.cookies["lyricus_token"] = token
    response.cookies["lyricus_token"]["httponly"] = True
    response.cookies["lyricus_token"]["samesite"] = "Lax"
    response.cookies["lyricus_token"]["max-age"] = 7 * 24 * 3600
    response.cookies["lyricus_token"]["path"] = "/"


def _clear_jwt_cookie(response):
    response.cookies["lyricus_token"] = ""
    response.cookies["lyricus_token"]["max-age"] = 0
    response.cookies["lyricus_token"]["path"] = "/"


def _link_user_id_from_state(state: str) -> str | None:
    if not state:
        return None
    payload = decode(state)
    return payload.get("link_user") if payload else None


def _make_state(link_user_id: str | None) -> str:
    if link_user_id:
        return encode({"link_user": link_user_id})
    return encode({"p": "auth"})


def _get_link_user_id(request) -> str | None:
    if request.args.get("link") != "1":
        return None
    p = get_user_from_request(request)
    return p["sub"] if p else None


async def _finish_oauth(pool, user, state: str, get_by_id_fn, link_fn, provider_id: str, success_key: str):
    """Handle both link mode and normal login for any provider."""
    link_user_id = _link_user_id_from_state(state)
    if link_user_id:
        existing = await get_by_id_fn(pool, provider_id)
        if existing and str(existing["id"]) != link_user_id:
            return redirect(f"/settings?link_error=already_used")
        ok = await link_fn(pool, link_user_id, provider_id)
        if not ok:
            return redirect(f"/settings?link_error=already_used")
        return redirect(f"/settings?link_success={success_key}")
    return None  # caller handles normal flow


# ── Google ────────────────────────────────────────────────────────────────────

@auth_bp.get("/google")
async def google_login(request):
    link_user_id = _get_link_user_id(request)
    if request.args.get("link") == "1" and not link_user_id:
        return redirect("/login")
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": _redirect_uri("google"),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": _make_state(link_user_id),
    }
    return redirect(GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params))


@auth_bp.get("/callback")
async def google_callback(request):
    code = request.args.get("code")
    state = request.args.get("state", "")
    if not code:
        return redirect("/?auth_error=no_code")

    session = request.app.ctx.session
    async with session.post(GOOGLE_TOKEN_URL, data={
        "code": code,
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
        "redirect_uri": _redirect_uri("google"),
        "grant_type": "authorization_code",
    }) as resp:
        tokens = await resp.json()
    access_token = tokens.get("access_token")
    if not access_token:
        return redirect("/?auth_error=no_token")

    async with session.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}) as resp:
        info = await resp.json()

    pool = request.app.ctx.pool
    r = await _finish_oauth(pool, None, state, get_user_by_google_id, link_google_to_user, info["id"], "google")
    if r:
        return r

    user = await get_or_create_user(pool, google_id=info["id"], email=info.get("email", ""), avatar=info.get("picture", ""))
    dest = "/" if user["username_set"] else "/setup"
    response = redirect(dest)
    _set_jwt_cookie(response, user)
    return response


# ── Discord ───────────────────────────────────────────────────────────────────

@auth_bp.get("/discord")
async def discord_login(request):
    link_user_id = _get_link_user_id(request)
    if request.args.get("link") == "1" and not link_user_id:
        return redirect("/login")
    params = {
        "client_id": os.environ["DISCORD_CLIENT_ID"],
        "redirect_uri": _redirect_uri("discord"),
        "response_type": "code",
        "scope": "identify email",
        "state": _make_state(link_user_id),
    }
    return redirect(DISCORD_AUTH_URL + "?" + urllib.parse.urlencode(params))


@auth_bp.get("/discord/callback")
async def discord_callback(request):
    code = request.args.get("code")
    state = request.args.get("state", "")
    if not code:
        return redirect("/?auth_error=no_code")

    session = request.app.ctx.session
    async with session.post(DISCORD_TOKEN_URL, data={
        "client_id": os.environ["DISCORD_CLIENT_ID"],
        "client_secret": os.environ["DISCORD_CLIENT_SECRET"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri("discord"),
    }, headers={"Content-Type": "application/x-www-form-urlencoded"}) as resp:
        tokens = await resp.json()
    access_token = tokens.get("access_token")
    if not access_token:
        return redirect("/?auth_error=no_token")

    async with session.get(DISCORD_API_URL, headers={"Authorization": f"Bearer {access_token}"}) as resp:
        info = await resp.json()

    discord_id = str(info.get("id", ""))
    avatar_hash = info.get("avatar")
    avatar = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png" if avatar_hash else ""

    pool = request.app.ctx.pool
    r = await _finish_oauth(pool, None, state, get_user_by_discord_id, link_discord_to_user, discord_id, "discord")
    if r:
        return r

    user = await get_or_create_user_discord(pool, discord_id, info.get("email", ""), avatar)
    if user is None:
        return redirect("/login?auth_error=email_taken")
    dest = "/" if user["username_set"] else "/setup"
    response = redirect(dest)
    _set_jwt_cookie(response, user)
    return response




# ── Me ────────────────────────────────────────────────────────────────────────

@auth_bp.get("/me")
async def me(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="auth_me", max_req=60, window=60):
        return rate_limit_response()

    payload = get_user_from_request(request)
    if not payload:
        return json({"user": None}, status=401)

    row = await get_user_by_id(request.app.ctx.pool, payload["sub"])
    if not row:
        return json({"user": None}, status=401)

    return json({"user": {
        "id":          str(row["id"]),
        "email":       row["email"],
        "name":        row["name"],
        "needs_setup": not row["username_set"],
        "public_history": row.get("public_history", True),
        "providers": {
            "email":    row.get("password_hash") is not None,
            "google":   row.get("google_id") is not None,
            "discord":  row.get("discord_id") is not None,
            "apple":    row.get("apple_id") is not None,
            "facebook": row.get("facebook_id") is not None,
        },
    }})


@auth_bp.patch("/me")
async def update_me(request):
    payload = get_user_from_request(request)
    if not payload:
        return json({"error": "unauthorized"}, status=401)

    body = request.json or {}
    pool = request.app.ctx.pool

    if "public_history" in body:
        ph = bool(body["public_history"])
        await pool.execute("UPDATE users SET public_history = $1 WHERE id = $2", ph, payload["sub"])
        return json({"ok": True})

    name = body.get("name", "").strip()
    if not name:
        return json({"error": "no changes"}, status=400)
    if not USERNAME_RE.match(name):
        return json({"error": "pseudo invalide (2-20 caractères, lettres, chiffres, _ - .)"}, status=400)

    row = await update_username(pool, payload["sub"], name)
    if row is None:
        return json({"error": "ce pseudo est déjà utilisé"}, status=409)
    response = json({"ok": True, "user": {"name": row["name"]}})
    _set_jwt_cookie(response, row)
    return response


@auth_bp.delete("/me")
async def delete_me(request):
    payload = get_user_from_request(request)
    if not payload:
        return json({"error": "unauthorized"}, status=401)
    await delete_user(request.app.ctx.pool, payload["sub"])
    response = json({"ok": True})
    _clear_jwt_cookie(response)
    return response


# ── Register / Login / Logout ─────────────────────────────────────────────────

@auth_bp.post("/register")
async def register(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="register", max_req=5, window=3600):
        return rate_limit_response()

    body = request.json or {}
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not EMAIL_RE.match(email):
        return json({"error": "adresse email invalide"}, status=400)
    err = _validate_password(password)
    if err:
        return json({"error": err}, status=400)

    user = await register_user(request.app.ctx.pool, email, password)
    if user is None:
        return json({"error": "cette adresse email est déjà utilisée"}, status=409)

    response = json({"ok": True, "needs_setup": True})
    _set_jwt_cookie(response, user)
    return response


@auth_bp.post("/login")
async def login(request):
    ip = request.ip or "unknown"
    if is_rate_limited(ip, key="login", max_req=10, window=900):
        return rate_limit_response()

    body = request.json or {}
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not email or not password:
        return json({"error": "email et mot de passe requis"}, status=400)

    user = await get_user_by_email(request.app.ctx.pool, email)
    dummy_hash = "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    pw_hash = user["password_hash"] if user and user.get("password_hash") else dummy_hash
    valid = verify_password(password, pw_hash)

    if not user or not valid:
        return json({"error": "email ou mot de passe incorrect"}, status=401)

    response = json({"ok": True, "needs_setup": not user["username_set"]})
    _set_jwt_cookie(response, user)
    return response


@auth_bp.post("/logout")
async def logout(request):
    response = json({"ok": True})
    _clear_jwt_cookie(response)
    return response
