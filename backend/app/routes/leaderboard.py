import asyncio
from datetime import date, timedelta
from sanic import Blueprint, json
from app.utils.jwt_utils import get_user_from_request
from app.utils import cache as cache_store

DEEZER_BASE = "https://api.deezer.com"


async def _deezer_artist_picture(session, name: str) -> str:
    key = f"artist_pic:{name.lower()}"
    cached = cache_store.get(key)
    if cached is not None:
        return cached
    try:
        async with session.get(
            f"{DEEZER_BASE}/search/artist",
            params={"q": name, "limit": "1"},
        ) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                pic = (data.get("data") or [{}])[0].get("picture_medium", "")
                cache_store.set(key, pic)
                return pic
    except Exception:
        pass
    cache_store.set(key, "")
    return ""

leaderboard_bp = Blueprint("leaderboard", url_prefix="/api")

_RANKED_CTE = """
WITH ranked AS (
    SELECT
        u.id,
        u.name,
        COUNT(*)::int                                                            AS games,
        ROUND(AVG(
            CASE WHEN s.score_total > 0
                 THEN s.score_correct * 100.0 / s.score_total ELSE 0 END
        ), 1)::float                                                             AS avg_score,
        ROUND(MAX(
            CASE WHEN s.score_total > 0
                 THEN s.score_correct * 100.0 / s.score_total ELSE 0 END
        ), 1)::float                                                             AS best_score,
        ROW_NUMBER() OVER (
            ORDER BY AVG(
                CASE WHEN s.score_total > 0
                     THEN s.score_correct * 100.0 / s.score_total ELSE 0 END
            ) DESC, COUNT(*) DESC
        )::int                                                                   AS rank
    FROM game_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.score_total > 0 {period_filter}
    GROUP BY u.id, u.name
    HAVING COUNT(*) >= 1
)
"""


@leaderboard_bp.get("/leaderboard")
async def get_leaderboard(request):
    period = request.args.get("period", "all")
    pool   = request.app.ctx.pool
    payload = get_user_from_request(request)
    user_id = payload["sub"] if payload else None

    pf = "AND s.played_at >= NOW() - INTERVAL '7 days'" if period == "week" else ""
    cte = _RANKED_CTE.format(period_filter=pf)

    if user_id:
        # Return top 50 + current user's row (if outside top 50)
        rows = await pool.fetch(
            cte + """
            SELECT id::text, name, games, avg_score, best_score, rank,
                   (id::text = $1) AS is_me
            FROM ranked
            WHERE rank <= 50 OR id::text = $1
            ORDER BY rank
            """,
            user_id,
        )
    else:
        rows = await pool.fetch(
            cte + """
            SELECT id::text, name, games, avg_score, best_score, rank,
                   false AS is_me
            FROM ranked
            ORDER BY rank LIMIT 50
            """,
        )

    result = [
        {
            "rank":       r["rank"],
            "name":       r["name"] or "anonymous",
            "games":      r["games"],
            "avg_score":  r["avg_score"],
            "best_score": r["best_score"],
            "is_me":      r["is_me"],
        }
        for r in rows
    ]

    response = json(result)
    response.headers["Cache-Control"] = "private, max-age=60"
    return response


@leaderboard_bp.get("/users/<username>")
async def get_user_profile(request, username: str):
    pool = request.app.ctx.pool
    payload = get_user_from_request(request)
    current_user_id = payload["sub"] if payload else None

    row = await pool.fetchrow(
        """
        SELECT
            u.id::text,
            u.name,
            u.public_history,
            COUNT(s.id)::int                                                          AS games,
            ROUND(AVG(
                CASE WHEN s.score_total > 0
                     THEN s.score_correct * 100.0 / s.score_total ELSE 0 END
            ), 1)::float                                                              AS avg_score,
            ROUND(MAX(
                CASE WHEN s.score_total > 0
                     THEN s.score_correct * 100.0 / s.score_total ELSE 0 END
            ), 1)::float                                                              AS best_score,
            COUNT(DISTINCT s.title || '|' || s.artist)::int                          AS unique_songs
        FROM users u
        LEFT JOIN game_sessions s ON s.user_id = u.id AND s.score_total > 0
        WHERE u.name ILIKE $1
        GROUP BY u.id, u.name, u.public_history
        """,
        username,
    )
    if not row:
        return json({"error": "not found"}, status=404)

    # Get rank
    rank_row = await pool.fetchrow(
        """
        WITH ranked AS (
            SELECT u2.id,
                   ROW_NUMBER() OVER (
                       ORDER BY AVG(
                           CASE WHEN s2.score_total > 0
                                THEN s2.score_correct * 100.0 / s2.score_total ELSE 0 END
                       ) DESC, COUNT(*) DESC
                   )::int AS rank
            FROM game_sessions s2
            JOIN users u2 ON u2.id = s2.user_id
            WHERE s2.score_total > 0
            GROUP BY u2.id HAVING COUNT(*) >= 1
        )
        SELECT rank FROM ranked WHERE id = $1
        """,
        row["id"],
    )

    is_me = current_user_id == row["id"]
    can_see_history = row["public_history"] or is_me

    async def _empty():
        return []

    recent, by_diff, by_mode, fav_artist_rows, play_days_rows = await asyncio.gather(
        pool.fetch(
            """
            SELECT artist, title, album, difficulty, mode, score_correct, score_total, played_at, cover, is_daily
            FROM game_sessions
            WHERE user_id = $1 AND score_total > 0
            ORDER BY played_at DESC LIMIT 10
            """,
            row["id"],
        ) if can_see_history else _empty(),
        pool.fetch(
            """
            SELECT difficulty,
                   COUNT(*)::int AS games,
                   ROUND(AVG(score_correct * 100.0 / score_total), 1)::float AS avg_score
            FROM game_sessions
            WHERE user_id = $1 AND score_total > 0
            GROUP BY difficulty
            ORDER BY CASE difficulty
                WHEN 'easy' THEN 1 WHEN 'medium' THEN 2
                WHEN 'hard' THEN 3 WHEN 'extreme' THEN 4 ELSE 5 END
            """,
            row["id"],
        ),
        pool.fetch(
            """
            SELECT mode,
                   COUNT(*)::int AS games,
                   ROUND(AVG(score_correct * 100.0 / score_total), 1)::float AS avg_score
            FROM game_sessions
            WHERE user_id = $1 AND score_total > 0
            GROUP BY mode
            """,
            row["id"],
        ),
        pool.fetch(
            """
            SELECT
                SPLIT_PART(SPLIT_PART(artist, ' feat', 1), ' ft.', 1) AS clean_artist,
                COUNT(*)::int AS cnt
            FROM game_sessions WHERE user_id = $1 AND score_total > 0
            GROUP BY clean_artist ORDER BY cnt DESC LIMIT 5
            """,
            row["id"],
        ),
        pool.fetch(
            """
            SELECT DISTINCT DATE(played_at) AS day
            FROM game_sessions WHERE user_id = $1
            ORDER BY day DESC
            """,
            row["id"],
        ),
    )

    # Compute streak
    days = [r["day"] for r in play_days_rows]
    streak = 0
    if days:
        today = date.today()
        if days[0] >= today - timedelta(days=1):
            streak = 1
            for i in range(1, len(days)):
                if days[i - 1] - days[i] == timedelta(days=1):
                    streak += 1
                else:
                    break

    # Fetch Deezer pictures for top artists
    session = request.app.ctx.session
    top_artists = []
    for r in fav_artist_rows:
        pic = await _deezer_artist_picture(session, r["clean_artist"])
        top_artists.append({"name": r["clean_artist"], "plays": r["cnt"], "picture": pic})

    response = json({
        "name":             row["name"],
        "games":            row["games"],
        "avg_score":        row["avg_score"],
        "best_score":       row["best_score"],
        "unique_songs":     row["unique_songs"],
        "rank":             rank_row["rank"] if rank_row else None,
        "streak":           streak,
        "top_artists":      top_artists,
        "public_history":   row["public_history"],
        "is_me":            is_me,
        "by_difficulty": [
            {"difficulty": r["difficulty"], "games": r["games"], "avg_score": r["avg_score"]}
            for r in by_diff
        ],
        "by_mode": [
            {"mode": r["mode"], "games": r["games"], "avg_score": r["avg_score"]}
            for r in by_mode
        ],
        "recent": [
            {
                "artist":        r["artist"],
                "title":         r["title"],
                "album":         r["album"],
                "cover":         r["cover"] or "",
                "difficulty":    r["difficulty"],
                "mode":          r["mode"],
                "score_correct": r["score_correct"],
                "score_total":   r["score_total"],
                "played_at":     r["played_at"].isoformat(),
                "is_daily":      bool(r["is_daily"] or False),
            }
            for r in recent
        ],
    })
    response.headers["Cache-Control"] = "public, max-age=60"
    return response


@leaderboard_bp.get("/stats")
async def get_stats(request):
    pool = request.app.ctx.pool
    row  = await pool.fetchrow(
        """
        SELECT
            COUNT(DISTINCT s.id)::int                    AS total_games,
            COUNT(DISTINCT s.user_id)::int               AS total_players,
            COUNT(DISTINCT s.title || '|' || s.artist)::int AS total_songs
        FROM game_sessions s
        """
    )
    response = json({
        "total_games":   row["total_games"],
        "total_players": row["total_players"],
        "total_songs":   row["total_songs"],
    })
    response.headers["Cache-Control"] = "public, max-age=120, s-maxage=120"
    return response
