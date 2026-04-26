#!/usr/bin/env python3
"""
Migration: populate unique_correct / unique_total for all existing finished game sessions.

Flow mode  → re-fetches lyrics from lrclib using stored seed → reconstructs word map → counts unique.
Normal mode → parses details JSON (items[].expected) → groups by word → counts unique.

Run inside the backend container:
  docker compose -f docker-compose.dev.yml exec backend-dev python migrate_unique_scores.py
"""
import asyncio
import json
import os
import sys
from collections import defaultdict

import aiohttp
import asyncpg

sys.path.insert(0, "/app")
from app.utils.text import mask_lyrics, normalize

LRCLIB_BASE = "https://lrclib.net/api"
DB_URL = os.environ.get("DATABASE_URL", "postgresql://lyricus:lyricus@postgres-dev:5432/lyricus")


# ── lrclib helper ─────────────────────────────────────────────────────────────

async def lrclib_fetch(session: aiohttp.ClientSession, artist: str, title: str, album: str = "") -> dict | None:
    params = {"artist_name": artist, "track_name": title}
    if album:
        params["album_name"] = album
    try:
        async with session.get(f"{LRCLIB_BASE}/get", params=params,
                               timeout=aiohttp.ClientTimeout(total=15)) as r:
            if r.status == 200:
                d = await r.json()
                if d.get("plainLyrics"):
                    return d
    except Exception:
        pass
    # Fuzzy search fallback
    try:
        async with session.get(f"{LRCLIB_BASE}/search",
                               params={"q": f"{artist} {title}"},
                               timeout=aiohttp.ClientTimeout(total=15)) as r:
            if r.status == 200:
                results = await r.json()
                for res in (results or [])[:5]:
                    if res.get("plainLyrics"):
                        return res
    except Exception:
        pass
    return None


# ── unique-count helpers ───────────────────────────────────────────────────────

def unique_from_answers(answers: dict, revealed_ids: set) -> tuple[int, int]:
    """Flow mode: answers = {str_id: word}, revealed_ids = set of int ids."""
    word_to_ids: dict[str, list[int]] = defaultdict(list)
    for id_str, word in answers.items():
        word_to_ids[normalize(word)].append(int(id_str))
    unique_total   = len(word_to_ids)
    unique_correct = sum(1 for ids in word_to_ids.values() if any(i in revealed_ids for i in ids))
    return unique_correct, unique_total


def unique_from_items(items: list) -> tuple[int, int]:
    """Normal mode: items = [{expected, correct, ...}]."""
    word_results: dict[str, list[bool]] = defaultdict(list)
    for item in items:
        word = normalize(item.get("expected") or "")
        if word:
            word_results[word].append(bool(item.get("correct", False)))
    unique_total   = len(word_results)
    unique_correct = sum(1 for results in word_results.values() if any(results))
    return unique_correct, unique_total


# ── main ──────────────────────────────────────────────────────────────────────

async def main():
    conn = await asyncpg.connect(DB_URL)

    rows = await conn.fetch("""
        SELECT id, artist, title, album, difficulty, mode, seed, details
        FROM game_sessions
        WHERE status = 'finished' AND score_total > 0
          AND (unique_correct IS NULL OR unique_total IS NULL)
        ORDER BY played_at DESC
    """)

    print(f"Sessions to migrate: {len(rows)}")
    if not rows:
        print("Nothing to do.")
        await conn.close()
        return

    # Cache lrclib responses per (artist, title, album) to avoid duplicate fetches
    lyrics_cache: dict[tuple, dict | None] = {}

    updated = skipped = failed = 0

    async with aiohttp.ClientSession() as http:
        for i, row in enumerate(rows, 1):
            mode    = row["mode"]
            details = {}
            try:
                if row["details"]:
                    details = json.loads(row["details"])
            except Exception:
                pass

            unique_correct = unique_total = None

            if mode == "normal":
                items = details.get("items", [])
                if items:
                    unique_correct, unique_total = unique_from_items(items)
                else:
                    skipped += 1
                    print(f"  [{i}/{len(rows)}] SKIP normal session {row['id']} — no items in details")
                    continue

            elif mode == "flow":
                seed = row["seed"]
                if seed is None:
                    skipped += 1
                    print(f"  [{i}/{len(rows)}] SKIP flow session {row['id']} — no seed stored")
                    continue

                revealed_ids = set(details.get("revealed_ids", []))

                cache_key = (row["artist"].lower(), row["title"].lower(), (row["album"] or "").lower())
                if cache_key not in lyrics_cache:
                    print(f"  [{i}/{len(rows)}] Fetching lrclib: {row['artist']} – {row['title']}")
                    lyrics_cache[cache_key] = await lrclib_fetch(http, row["artist"], row["title"], row["album"] or "")
                    await asyncio.sleep(0.3)  # be nice to lrclib

                data = lyrics_cache[cache_key]
                if not data or not data.get("plainLyrics"):
                    failed += 1
                    print(f"  [{i}/{len(rows)}] FAIL — lrclib returned nothing for {row['artist']} – {row['title']}")
                    continue

                tokens = mask_lyrics(data["plainLyrics"], row["difficulty"], seed=int(seed))
                answers = {}
                blank_id = 0
                for tok in tokens:
                    if tok["type"] == "blank":
                        answers[str(blank_id)] = tok["value"]
                        blank_id += 1

                unique_correct, unique_total = unique_from_answers(answers, revealed_ids)

            else:
                skipped += 1
                continue

            await conn.execute(
                "UPDATE game_sessions SET unique_correct=$1, unique_total=$2 WHERE id=$3",
                unique_correct, unique_total, row["id"],
            )
            updated += 1
            print(f"  [{i}/{len(rows)}] OK  {row['artist']} – {row['title']} "
                  f"({mode}) → {unique_correct}/{unique_total} unique")

    await conn.close()
    print(f"\nDone — updated: {updated}, skipped: {skipped}, failed: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
