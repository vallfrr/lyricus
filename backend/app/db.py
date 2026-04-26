import asyncpg
import os
import bcrypt
import json


async def create_pool():
    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)

    with open("/app/migrations.sql") as f:
        sql = f.read()

    statements = [s.strip() for s in sql.split(";") if s.strip()]
    async with pool.acquire() as conn:
        for stmt in statements:
            try:
                await conn.execute(stmt)
            except Exception as e:
                print(f"[migration] warning on statement: {e}\n  SQL: {stmt[:120]}")

    return pool


async def get_or_create_user(pool, google_id: str, email: str, avatar: str) -> dict:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO users (google_id, email, name, avatar, username_set, public_history)
            VALUES ($1, $2, NULL, $3, FALSE, TRUE)
            ON CONFLICT (google_id) DO UPDATE
              SET email   = EXCLUDED.email,
                  avatar  = EXCLUDED.avatar
            RETURNING id, google_id, email, name, avatar, username_set
            """,
            google_id, email, avatar,
        )
    return dict(row)


async def update_username(pool, user_id: str, name: str) -> dict | None:
    """Returns None if username is already taken."""
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE users SET name = $1, username_set = TRUE
                WHERE id = $2
                RETURNING id, email, name, username_set
                """,
                name, user_id,
            )
        return dict(row)
    except asyncpg.UniqueViolationError:
        return None


_ALL_COLS = "id, email, name, username_set, public_history, preview_volume, google_id, discord_id, apple_id, facebook_id, password_hash"


async def get_user_by_id(pool, user_id: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {_ALL_COLS} FROM users WHERE id = $1", user_id)
    return dict(row) if row else None


async def _get_user_by_provider(pool, column: str, value: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT id, email FROM users WHERE {column} = $1", value)
    return dict(row) if row else None


async def _get_or_create_oauth_user(pool, column: str, value: str, email: str, avatar: str) -> dict | None:
    """Returns None if the email is already used by a different account."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {_ALL_COLS} FROM users WHERE {column} = $1", value)
        if row:
            return dict(row)
        try:
            row = await conn.fetchrow(
                f"""INSERT INTO users ({column}, email, name, avatar, username_set, public_history)
                VALUES ($1, $2, NULL, $3, FALSE, TRUE)
                RETURNING {_ALL_COLS}""",
                value, email or "", avatar,
            )
            return dict(row) if row else None
        except asyncpg.UniqueViolationError:
            return None


async def _link_provider(pool, user_id: str, column: str, value: str) -> bool:
    """Returns False if the provider ID is already used by another user."""
    try:
        async with pool.acquire() as conn:
            await conn.execute(f"UPDATE users SET {column} = $1 WHERE id = $2", value, user_id)
        return True
    except asyncpg.UniqueViolationError:
        return False


async def get_user_by_google_id(pool, v):    return await _get_user_by_provider(pool, "google_id", v)
async def link_google_to_user(pool, uid, v):   return await _link_provider(pool, uid, "google_id", v)

async def get_user_by_discord_id(pool, v):     return await _get_user_by_provider(pool, "discord_id", v)
async def get_or_create_user_discord(pool, v, email, avatar): return await _get_or_create_oauth_user(pool, "discord_id", v, email, avatar)
async def link_discord_to_user(pool, uid, v):  return await _link_provider(pool, uid, "discord_id", v)

async def get_user_by_apple_id(pool, v):       return await _get_user_by_provider(pool, "apple_id", v)
async def get_or_create_user_apple(pool, v, email, avatar):   return await _get_or_create_oauth_user(pool, "apple_id", v, email, avatar)
async def link_apple_to_user(pool, uid, v):    return await _link_provider(pool, uid, "apple_id", v)

async def get_user_by_facebook_id(pool, v):    return await _get_user_by_provider(pool, "facebook_id", v)
async def get_or_create_user_facebook(pool, v, email, avatar): return await _get_or_create_oauth_user(pool, "facebook_id", v, email, avatar)
async def link_facebook_to_user(pool, uid, v): return await _link_provider(pool, uid, "facebook_id", v)


async def delete_user(pool, user_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)


async def get_user_playlists(pool, user_id: str) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, platform, url, name, cover, track_count, added_at FROM user_playlists WHERE user_id = $1 ORDER BY added_at DESC",
            user_id,
        )
    return [{**dict(r), "id": str(r["id"]), "added_at": r["added_at"].isoformat()} for r in rows]


async def add_user_playlist(pool, user_id: str, platform: str, url: str, name: str, cover: str, track_count: int) -> dict:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO user_playlists (user_id, platform, url, name, cover, track_count)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, platform, url, name, cover, track_count, added_at""",
            user_id, platform, url, name, cover, track_count,
        )
        return {**dict(row), "id": str(row["id"]), "added_at": row["added_at"].isoformat()}


async def delete_user_playlist(pool, user_id: str, playlist_id: str) -> bool:
    async with pool.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM user_playlists WHERE user_id = $1 AND id = $2",
            user_id, playlist_id,
        )
        return res == "DELETE 1"


_DIFF_MULT = {"easy": 1.0, "medium": 1.5, "hard": 2.5, "extreme": 4.0}

_POINTS_SQL = """
    SELECT COALESCE(MAX(
        COALESCE(unique_correct, score_correct) *
        CASE difficulty
            WHEN 'easy'    THEN 1.0 WHEN 'medium' THEN 1.5
            WHEN 'hard'    THEN 2.5 WHEN 'extreme' THEN 4.0
            ELSE 1.0 END
    ), 0)
    FROM game_sessions
    WHERE user_id=$1 AND LOWER(artist)=$2 AND LOWER(title)=$3
      AND score_total > 0 AND status = 'finished'
"""

async def compute_points_gained(pool, user_id: str, artist: str, title: str,
                                difficulty: str, score_correct: int, score_total: int,
                                unique_correct: int | None = None,
                                unique_total:   int | None = None) -> tuple[int, int]:
    """Returns (new_song_points, gained_points).
    Points = unique_correct * difficulty_multiplier.
    Falls back to score_correct if unique data not available.
    Call BEFORE saving/finishing the current session so it's not yet in 'finished' state."""
    if score_total == 0:
        return 0, 0
    mult    = _DIFF_MULT.get(difficulty, 1.0)
    count   = unique_correct if unique_correct is not None else score_correct
    new_pts = count * mult
    old_best = await pool.fetchval(_POINTS_SQL, user_id, artist.lower(), title.lower())
    gained   = max(0.0, new_pts - float(old_best or 0))
    return round(new_pts), round(gained)


async def save_game_session(pool, user_id: str, data: dict) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO game_sessions
              (user_id, artist, title, album, difficulty, mode,
               score_correct, score_total, unique_correct, unique_total,
               duration_seconds, cover, details, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'finished')
            RETURNING id
            """,
            user_id,
            data["artist"], data["title"], data.get("album", ""),
            data["difficulty"], data["mode"],
            data["score_correct"], data["score_total"],
            data.get("unique_correct"), data.get("unique_total"),
            data.get("duration_seconds"),
            data.get("cover", ""),
            data.get("details"),
        )
    return str(row["id"])

async def start_game_session(pool, user_id: str, data: dict) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO game_sessions
              (user_id, artist, title, album, difficulty, mode, cover,
               status, seed, is_daily)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'playing',$8,$9)
            RETURNING id
            """,
            user_id,
            data.get("artist", ""), data.get("title", ""), data.get("album", ""),
            data.get("difficulty", "medium"), data.get("mode", "normal"),
            data.get("cover", ""),
            data.get("seed"),
            bool(data.get("is_daily", False)),
        )
    return str(row["id"])

async def finish_db_session(pool, session_id: str, user_id: str, data: dict):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE game_sessions
            SET status = 'finished',
                score_correct    = $1,
                score_total      = $2,
                unique_correct   = $3,
                unique_total     = $4,
                duration_seconds = $5,
                details          = $6
            WHERE id = $7 AND user_id = $8
            """,
            data.get("score_correct", 0),
            data.get("score_total", 0),
            data.get("unique_correct"),
            data.get("unique_total"),
            data.get("duration_seconds"),
            data.get("details"),
            session_id, user_id
        )

async def delete_game_session(pool, session_id: str, user_id: str):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM game_sessions WHERE id = $1 AND user_id = $2", session_id, user_id)

async def update_db_progress(pool, session_id: str, user_id: str, details: str):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE game_sessions
            SET details = $1
            WHERE id = $2 AND user_id = $3 AND status = 'playing'
            """,
            details, session_id, user_id
        )

async def get_game_session(pool, session_id: str, user_id: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, artist, title, album, difficulty, mode, cover,
                   status, seed, details
            FROM game_sessions
            WHERE id = $1 AND user_id = $2
            """,
            session_id, user_id
        )
        if not row: return None
        return dict(row)

async def get_unfinished_sessions(pool, user_id: str) -> list[dict]:
    import json as _json
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, artist, title, album, difficulty, mode, cover, played_at, details
            FROM game_sessions
            WHERE user_id = $1 AND status = 'playing'
              AND (is_daily IS NULL OR is_daily = FALSE)
            ORDER BY played_at DESC
            """,
            user_id
        )
    result = []
    for r in rows:
        d = {**dict(r), "id": str(r["id"]), "played_at": r["played_at"].isoformat()}
        if d.get("details"):
            try:
                parsed = _json.loads(d["details"])
                if isinstance(parsed, dict):
                    d.update(parsed)
            except:
                pass
        # Remove details string to save bandwidth if it's already merged
        d.pop("details", None)
        result.append(d)
    return result


async def register_user(pool, email: str, password: str) -> dict | None:
    """Create a new user with email/password. Returns None if email already taken."""
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO users (google_id, email, name, avatar, username_set, password_hash, public_history)
            VALUES (NULL, $1, NULL, '', FALSE, $2, TRUE)
            ON CONFLICT (email) DO NOTHING
            RETURNING id, email, name, username_set, public_history
            """,
            email.lower().strip(), pw_hash,
        )
    return dict(row) if row else None


async def get_user_by_email(pool, email: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, username_set, public_history, password_hash FROM users WHERE email = $1",
            email.lower().strip(),
        )
    return dict(row) if row else None


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


async def get_user_history(pool, user_id: str, limit: int = 100) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, artist, title, album, difficulty, mode,
                   score_correct, score_total, unique_correct, unique_total,
                   duration_seconds, played_at, cover, details, is_daily
            FROM game_sessions
            WHERE user_id = $1 AND status = 'finished'
            ORDER BY played_at DESC
            LIMIT $2
            """,
            user_id, limit,
        )
    return [
        {**dict(r), "id": str(r["id"]), "played_at": r["played_at"].isoformat(), "is_daily": bool(r["is_daily"] or False)}
        for r in rows
    ]
