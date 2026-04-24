import os
import asyncio
import aiohttp
from sanic import Sanic
from sanic_cors import CORS
from app.routes.songs import songs_bp, deezer_enrich
from app.routes.lyrics import lyrics_bp
from app.routes.auth import auth_bp
from app.routes.history import history_bp
from app.routes.leaderboard import leaderboard_bp
from app.routes.daily import daily_bp
from app.routes.playlists import playlists_bp
from app.routes.badges import badges_bp
from app.db import create_pool

app = Sanic("Lyricus")

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
CORS(app, resources={r"/api/*": {"origins": FRONTEND_ORIGIN}}, supports_credentials=True)

app.blueprint(songs_bp)
app.blueprint(lyrics_bp)
app.blueprint(auth_bp)
app.blueprint(history_bp)
app.blueprint(leaderboard_bp)
app.blueprint(daily_bp)
app.blueprint(playlists_bp)
app.blueprint(badges_bp)


async def _backfill_covers(pool, session):
    """Backfill missing covers on game_sessions using Deezer search."""
    rows = await pool.fetch(
        "SELECT DISTINCT artist, title FROM game_sessions WHERE cover IS NULL OR cover = '' LIMIT 200"
    )
    if not rows:
        return
    print(f"[covers] backfilling {len(rows)} distinct artist/title pairs...")
    filled = 0
    for row in rows:
        artist, title = row["artist"], row["title"]
        extra = await deezer_enrich(session, artist, title)
        cover = extra.get("cover", "")
        if cover:
            await pool.execute(
                "UPDATE game_sessions SET cover = $1 WHERE (cover IS NULL OR cover = '') AND artist = $2 AND title = $3",
                cover, artist, title,
            )
            filled += 1
        await asyncio.sleep(0.1)  # gentle throttle
    print(f"[covers] backfill done — {filled}/{len(rows)} covers found")


@app.before_server_start
async def setup(app, loop):
    connector = aiohttp.TCPConnector(limit=50, ttl_dns_cache=300, ssl=False)
    app.ctx.session = aiohttp.ClientSession(
        connector=connector,
        timeout=aiohttp.ClientTimeout(total=8),
    )
    app.ctx.pool = await create_pool()
    app.add_task(_backfill_covers(app.ctx.pool, app.ctx.session))


@app.after_server_stop
async def teardown(app, loop):
    await app.ctx.session.close()
    await app.ctx.pool.close()


@app.get("/health")
async def health(request):
    from sanic import json
    return json({"status": "ok"})

@app.get("/schema")
async def schema_dump(request):
    from sanic import json
    pool = request.app.ctx.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        schema = {}
        for row in rows:
            t = row['table_name']
            cols = await conn.fetch(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{t}'")
            schema[t] = {c['column_name']: c['data_type'] for c in cols}
    return json(schema)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, workers=2, debug=False)
