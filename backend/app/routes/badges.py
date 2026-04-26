from datetime import datetime, timezone
from sanic import Blueprint, json
from sanic.exceptions import SanicException
from app.utils.jwt_utils import get_user_from_request

badges_bp = Blueprint("badges", url_prefix="/api")

# ── Badge definitions ──────────────────────────────────────────────────────────

BADGES = [
    # Premiers pas
    {"id": "first_game",      "label": "première note",   "desc": "terminer sa première partie",           "icon": "Music"},
    # Streak
    {"id": "streak_3",        "label": "en feu",          "desc": "streak de 3 jours",                    "icon": "Flame"},
    {"id": "streak_7",        "label": "semaine parfaite","desc": "streak de 7 jours",                    "icon": "CalendarCheck"},
    {"id": "streak_30",       "label": "mois parfait",    "desc": "streak de 30 jours",                   "icon": "CalendarDays"},
    # Score
    {"id": "perfect_1",       "label": "sans faute",      "desc": "terminer une partie à 100%",           "icon": "CircleCheck"},
    {"id": "perfect_5",       "label": "x5",              "desc": "5 parties à 100%",                     "icon": "Zap"},
    {"id": "perfect_20",      "label": "perfectionniste", "desc": "20 parties à 100%",                    "icon": "Gem"},
    {"id": "perfect_extreme", "label": "sniper",          "desc": "100% en difficulté extrême",           "icon": "Target"},
    # Volume
    {"id": "games_10",        "label": "karaoké",         "desc": "10 parties jouées",                    "icon": "Mic"},
    {"id": "games_50",        "label": "mélomane",        "desc": "50 parties jouées",                    "icon": "Headphones"},
    {"id": "games_200",       "label": "légende",         "desc": "200 parties jouées",                   "icon": "Trophy"},
    # Artistes
    {"id": "fan",             "label": "fan",             "desc": "5 parties sur le même artiste",        "icon": "Star"},
    {"id": "superfan",        "label": "superfan",        "desc": "15 parties sur le même artiste",       "icon": "Crown"},
    # Difficulté
    {"id": "first_extreme",   "label": "courageux",       "desc": "première partie en extrême",           "icon": "Shield"},
    {"id": "extreme_10",      "label": "masochiste",      "desc": "10 parties en extrême",                "icon": "Swords"},
    # Défi du jour
    {"id": "daily_morning",   "label": "matinal",         "desc": "compléter le défi avant 9h",           "icon": "Sun"},
    {"id": "daily_night",     "label": "noctambule",      "desc": "compléter le défi après 23h",          "icon": "Moon"},
    {"id": "daily_10",        "label": "challenger",      "desc": "compléter 10 défis du jour",           "icon": "Medal"},
    {"id": "daily_30",        "label": "assidu",          "desc": "compléter 30 défis du jour",           "icon": "Award"},
    # Points
    {"id": "pts_500",         "label": "compositeur",     "desc": "atteindre 500 points",                 "icon": "Music2"},
    {"id": "pts_2000",        "label": "virtuose",        "desc": "atteindre 2 000 points",               "icon": "Star"},
    {"id": "pts_5000",        "label": "maestro",         "desc": "atteindre 5 000 points",               "icon": "Wand2"},
    {"id": "pts_15000",       "label": "légendaire",      "desc": "atteindre 15 000 points",              "icon": "Trophy"},
    {"id": "pts_50000",       "label": "iconique",        "desc": "atteindre 50 000 points",              "icon": "Crown"},
]

BADGE_IDS = {b["id"] for b in BADGES}


# ── Progress helpers ───────────────────────────────────────────────────────────

async def _get_user_progress(conn, user_id: str) -> dict:
    """Returns {badge_id: (current, total)} for all trackable badges."""
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND status='finished'", user_id)
    perfect = await conn.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND status='finished' AND score_total>0 AND score_correct=score_total", user_id)
    perf_ext = await conn.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND status='finished' AND difficulty='extreme' AND score_total>0 AND score_correct=score_total", user_id)
    extreme = await conn.fetchval(
        "SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND status='finished' AND difficulty='extreme'", user_id)
    best_row = await conn.fetchrow(
        "SELECT COUNT(*) as cnt FROM game_sessions WHERE user_id=$1 AND status='finished' GROUP BY LOWER(artist) ORDER BY cnt DESC LIMIT 1", user_id)
    best_cnt = best_row["cnt"] if best_row else 0
    user_row = await conn.fetchrow("SELECT current_streak FROM users WHERE id=$1", user_id)
    streak = (user_row["current_streak"] or 0) if user_row else 0
    daily_done = await conn.fetchval(
        "SELECT COUNT(*) FROM daily_challenges WHERE user_id=$1 AND completed_at IS NOT NULL", user_id)
    pts_row = await conn.fetchval(
        """
        SELECT COALESCE(ROUND(SUM(song_points)), 0)::bigint FROM (
            SELECT MAX(
                (COALESCE(unique_correct, score_correct)::numeric /
                 COALESCE(NULLIF(unique_total, 0), score_total)::numeric * 100.0) *
                CASE difficulty
                    WHEN 'easy' THEN 1.0 WHEN 'medium' THEN 1.5
                    WHEN 'hard' THEN 2.5 WHEN 'extreme' THEN 4.0
                    ELSE 1.0 END
            ) AS song_points
            FROM game_sessions
            WHERE user_id=$1 AND score_total>0 AND status='finished'
            GROUP BY LOWER(artist), LOWER(title)
        ) sub
        """,
        user_id,
    )
    total_pts = int(pts_row or 0)

    return {
        "first_game":      (min(total, 1),        1),
        "games_10":        (min(total, 10),        10),
        "games_50":        (min(total, 50),        50),
        "games_200":       (min(total, 200),       200),
        "perfect_1":       (min(perfect, 1),       1),
        "perfect_5":       (min(perfect, 5),       5),
        "perfect_20":      (min(perfect, 20),      20),
        "perfect_extreme": (min(perf_ext, 1),      1),
        "first_extreme":   (min(extreme, 1),       1),
        "extreme_10":      (min(extreme, 10),      10),
        "fan":             (min(best_cnt, 5),      5),
        "superfan":        (min(best_cnt, 15),     15),
        "streak_3":        (min(streak, 3),        3),
        "streak_7":        (min(streak, 7),        7),
        "streak_30":       (min(streak, 30),       30),
        "daily_10":        (min(daily_done, 10),   10),
        "daily_30":        (min(daily_done, 30),   30),
        "pts_500":         (min(total_pts, 500),   500),
        "pts_2000":        (min(total_pts, 2000),  2000),
        "pts_5000":        (min(total_pts, 5000),  5000),
        "pts_15000":       (min(total_pts, 15000), 15000),
        "pts_50000":       (min(total_pts, 50000), 50000),
        # daily_morning / daily_night have no numeric progress
    }


# ── Core logic ─────────────────────────────────────────────────────────────────

async def check_and_award(pool, user_id: str) -> list[str]:
    """Check all game-based badge conditions and award new ones. Returns newly awarded IDs."""
    async with pool.acquire() as conn:
        earned = {r["badge_id"] for r in await conn.fetch(
            "SELECT badge_id FROM user_badges WHERE user_id = $1", user_id
        )}

        progress = await _get_user_progress(conn, user_id)
        streak = progress["streak_3"][0]   # reuse already-fetched streak value
        daily_done = progress["daily_10"][0]

        candidates = []
        if progress["first_game"][0]      >= 1:   candidates.append("first_game")
        if progress["games_10"][0]        >= 10:  candidates.append("games_10")
        if progress["games_50"][0]        >= 50:  candidates.append("games_50")
        if progress["games_200"][0]       >= 200: candidates.append("games_200")
        if progress["perfect_1"][0]       >= 1:   candidates.append("perfect_1")
        if progress["perfect_5"][0]       >= 5:   candidates.append("perfect_5")
        if progress["perfect_20"][0]      >= 20:  candidates.append("perfect_20")
        if progress["perfect_extreme"][0] >= 1:   candidates.append("perfect_extreme")
        if progress["first_extreme"][0]   >= 1:   candidates.append("first_extreme")
        if progress["extreme_10"][0]      >= 10:  candidates.append("extreme_10")
        if progress["fan"][0]             >= 5:   candidates.append("fan")
        if progress["superfan"][0]        >= 15:  candidates.append("superfan")
        if progress["streak_3"][0]        >= 3:   candidates.append("streak_3")
        if progress["streak_7"][0]        >= 7:   candidates.append("streak_7")
        if progress["streak_30"][0]       >= 30:  candidates.append("streak_30")
        if progress["daily_10"][0]        >= 10:  candidates.append("daily_10")
        if progress["daily_30"][0]        >= 30:  candidates.append("daily_30")

        # pts_50000 progress is min(total_pts, 50000) — sufficient for all thresholds ≤ 50000
        _pts = progress["pts_50000"][0]
        if _pts >= 500:   candidates.append("pts_500")
        if _pts >= 2000:  candidates.append("pts_2000")
        if _pts >= 5000:  candidates.append("pts_5000")
        if _pts >= 15000: candidates.append("pts_15000")
        if _pts >= 50000: candidates.append("pts_50000")

        new_ids = []
        for bid in candidates:
            if bid not in earned:
                await conn.execute(
                    "INSERT INTO user_badges (user_id, badge_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    user_id, bid,
                )
                new_ids.append(bid)

    return new_ids


async def check_daily_time_badges(pool, user_id: str) -> list[str]:
    """Award time-of-day badges when a daily is just completed."""
    now_hour = datetime.now(timezone.utc).hour
    new_ids = []
    async with pool.acquire() as conn:
        earned = {r["badge_id"] for r in await conn.fetch(
            "SELECT badge_id FROM user_badges WHERE user_id=$1", user_id
        )}
        candidates = []
        if now_hour < 9:   candidates.append("daily_morning")
        if now_hour >= 23: candidates.append("daily_night")
        for bid in candidates:
            if bid not in earned:
                await conn.execute(
                    "INSERT INTO user_badges (user_id, badge_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    user_id, bid,
                )
                new_ids.append(bid)
    return new_ids


def _serialize(badge: dict, earned_ids: dict, progress: dict | None = None) -> dict:
    e = earned_ids.get(badge["id"])
    result = {
        **badge,
        "earned":    e is not None,
        "earned_at": e.isoformat() if e else None,
    }
    if not result["earned"] and progress:
        p = progress.get(badge["id"])
        if p:
            result["progress_current"] = int(p[0])
            result["progress_total"]   = int(p[1])
    return result


# ── Endpoints ──────────────────────────────────────────────────────────────────

@badges_bp.get("/badges")
async def get_badges(request):
    payload = get_user_from_request(request)
    pool = request.app.ctx.pool

    # Resolve target user: ?username=X for public profile view, else own profile
    target_user_id = None
    username_param = request.args.get("username")

    if username_param:
        row = await pool.fetchrow("SELECT id FROM users WHERE name=$1", username_param)
        if row:
            target_user_id = str(row["id"])
    elif payload:
        target_user_id = payload["sub"]

    earned_ids: dict = {}
    progress: dict = {}

    if target_user_id:
        rows = await pool.fetch(
            "SELECT badge_id, earned_at FROM user_badges WHERE user_id=$1", target_user_id
        )
        earned_ids = {r["badge_id"]: r["earned_at"] for r in rows}
        async with pool.acquire() as conn:
            progress = await _get_user_progress(conn, target_user_id)

    return json({
        "badges": [_serialize(b, earned_ids, progress) for b in BADGES],
    })


@badges_bp.post("/badges/check")
async def check_badges(request):
    payload = get_user_from_request(request)
    if not payload:
        raise SanicException("Unauthorized", status_code=401)

    new_ids = await check_and_award(request.app.ctx.pool, payload["sub"])
    new_badges = [b for b in BADGES if b["id"] in new_ids]
    return json({"new_badges": new_badges})
