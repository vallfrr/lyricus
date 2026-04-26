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
WITH best_per_song AS (
    SELECT
        s.user_id,
        LOWER(s.artist) AS artist,
        LOWER(s.title)  AS title,
        MAX(
            (COALESCE(s.unique_correct, s.score_correct)::numeric /
             COALESCE(NULLIF(s.unique_total, 0), s.score_total)::numeric * 100.0) *
            CASE s.difficulty
                WHEN 'easy'    THEN 1.0 WHEN 'medium' THEN 1.5
                WHEN 'hard'    THEN 2.5 WHEN 'extreme' THEN 4.0
                ELSE 1.0 END
        ) AS song_points
    FROM game_sessions s
    WHERE s.score_total > 0 AND s.status = 'finished' {period_filter}
    GROUP BY s.user_id, LOWER(s.artist), LOWER(s.title)
),
ranked AS (
    SELECT
        u.id,
        u.name,
        COALESCE(u.current_streak, 0)::int                    AS streak,
        COALESCE(ROUND(SUM(b.song_points)), 0)::bigint        AS total_points,
        COUNT(b.song_points)::int                             AS songs,
        COALESCE(ROUND(AVG(b.song_points), 1), 0)::float      AS avg_points,
        ROW_NUMBER() OVER (
            ORDER BY SUM(b.song_points) DESC NULLS LAST
        )::int                                                AS rank
    FROM users u
    JOIN best_per_song b ON b.user_id = u.id
    WHERE u.name IS NOT NULL
    GROUP BY u.id, u.name, u.current_streak
)
"""


_PER_PAGE = 100


@leaderboard_bp.get("/leaderboard")
async def get_leaderboard(request):
    period  = request.args.get("period", "all")
    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1

    pool    = request.app.ctx.pool
    payload = get_user_from_request(request)
    user_id = payload["sub"] if payload else None

    pf  = "AND s.played_at >= NOW() - INTERVAL '7 days'" if period == "week" else ""
    cte = _RANKED_CTE.format(period_filter=pf)
    offset = (page - 1) * _PER_PAGE

    async def _fetch_page():
        if user_id:
            return await pool.fetch(
                cte + """
                SELECT id::text, name, total_points, songs, avg_points, streak, rank,
                       (id::text = $1) AS is_me,
                       COUNT(*) OVER()::int AS total_count
                FROM ranked
                ORDER BY rank
                LIMIT $2 OFFSET $3
                """,
                user_id, _PER_PAGE, offset,
            )
        return await pool.fetch(
            cte + """
            SELECT id::text, name, total_points, songs, avg_points, streak, rank,
                   false AS is_me,
                   COUNT(*) OVER()::int AS total_count
            FROM ranked
            ORDER BY rank
            LIMIT $1 OFFSET $2
            """,
            _PER_PAGE, offset,
        )

    async def _fetch_my_rank():
        if not user_id:
            return None
        row = await pool.fetchrow(
            cte + "SELECT rank FROM ranked WHERE id::text = $1",
            user_id,
        )
        return row["rank"] if row else None

    rows, my_rank = await asyncio.gather(_fetch_page(), _fetch_my_rank())

    total_count = rows[0]["total_count"] if rows else 0
    total_pages = max(1, (total_count + _PER_PAGE - 1) // _PER_PAGE)
    my_page     = ((my_rank - 1) // _PER_PAGE) + 1 if my_rank else None

    result = [
        {
            "rank":         r["rank"],
            "name":         r["name"] or "anonymous",
            "total_points": int(r["total_points"]),
            "songs":        r["songs"],
            "avg_points":   r["avg_points"],
            "streak":       r["streak"],
            "is_me":        r["is_me"],
        }
        for r in rows
    ]

    response = json({
        "rows":        result,
        "page":        page,
        "total_pages": total_pages,
        "total":       total_count,
        "my_rank":     my_rank,
        "my_page":     my_page,
    })
    response.headers["Cache-Control"] = "private, max-age=60"
    return response


@leaderboard_bp.get("/users/<username>")
async def get_user_profile(request, username: str):
    pool = request.app.ctx.pool
    payload = get_user_from_request(request)
    current_user_id = payload["sub"] if payload else None

    row = await pool.fetchrow(
        """
        WITH user_pts AS (
            SELECT
                user_id,
                COALESCE(ROUND(SUM(song_points)), 0)::bigint         AS total_points,
                COUNT(*)::int                                         AS unique_songs,
                COALESCE(ROUND(AVG(song_points), 1), 0)::float       AS avg_points
            FROM (
                SELECT user_id,
                       MAX(
                           (COALESCE(unique_correct, score_correct)::numeric /
                            COALESCE(NULLIF(unique_total, 0), score_total)::numeric * 100.0) *
                           CASE difficulty
                               WHEN 'easy'    THEN 1.0 WHEN 'medium' THEN 1.5
                               WHEN 'hard'    THEN 2.5 WHEN 'extreme' THEN 4.0
                               ELSE 1.0 END
                       ) AS song_points
                FROM game_sessions
                WHERE score_total > 0 AND status = 'finished'
                GROUP BY user_id, LOWER(artist), LOWER(title)
            ) best
            GROUP BY user_id
        )
        SELECT
            u.id::text,
            u.name,
            u.public_history,
            COUNT(DISTINCT s.id)::int                                          AS games,
            COALESCE(p.total_points, 0)                                        AS total_points,
            COALESCE(p.unique_songs, 0)                                        AS unique_songs,
            COALESCE(p.avg_points, 0)                                          AS avg_points
        FROM users u
        LEFT JOIN game_sessions s ON s.user_id = u.id AND s.score_total > 0
        LEFT JOIN user_pts p ON p.user_id = u.id
        WHERE u.name ILIKE $1
        GROUP BY u.id, u.name, u.public_history, p.total_points, p.unique_songs, p.avg_points
        """,
        username,
    )
    if not row:
        return json({"error": "not found"}, status=404)

    # Get rank (points-based, same formula as leaderboard)
    rank_row = await pool.fetchrow(
        """
        WITH best_per_song AS (
            SELECT s2.user_id,
                   MAX(
                       (COALESCE(s2.unique_correct, s2.score_correct)::numeric /
                        COALESCE(NULLIF(s2.unique_total, 0), s2.score_total)::numeric * 100.0) *
                       CASE s2.difficulty
                           WHEN 'easy'    THEN 1.0 WHEN 'medium' THEN 1.5
                           WHEN 'hard'    THEN 2.5 WHEN 'extreme' THEN 4.0
                           ELSE 1.0 END
                   ) AS song_points
            FROM game_sessions s2
            WHERE s2.score_total > 0 AND s2.status = 'finished'
            GROUP BY s2.user_id, LOWER(s2.artist), LOWER(s2.title)
        ),
        ranked AS (
            SELECT u2.id,
                   ROW_NUMBER() OVER (
                       ORDER BY SUM(b.song_points) DESC NULLS LAST
                   )::int AS rank
            FROM users u2
            JOIN best_per_song b ON b.user_id = u2.id
            WHERE u2.name IS NOT NULL
            GROUP BY u2.id
        )
        SELECT rank FROM ranked WHERE id = $1::uuid
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
        "total_points":     int(row["total_points"] or 0),
        "unique_songs":     int(row["unique_songs"] or 0),
        "avg_points":       float(row["avg_points"] or 0),
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
