# Lyricus

A lyrics guessing game. Fill in the blanks of song lyrics across multiple difficulty levels and game modes.

## Stack

- **Frontend**: Next.js 15 (App Router)
- **Backend**: FastAPI (Python 3.12)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7

## Local dev setup

**Prerequisites**: Docker, Docker Compose

1. Clone the repo

```bash
git clone <repo-url>
cd lyricus
```

2. Create a `.env.dev` file at the root (all values with defaults are optional):

```env
POSTGRES_PASSWORD=lyricus_dev

JWT_SECRET=change-me

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

3. Start everything

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

The app is available at **http://localhost:3001**  
Adminer (DB browser) at **http://localhost:8081** → server: `postgres-dev`, user/pass/db: `lyricus`

## Stopping

```bash
docker compose -f docker-compose.dev.yml down
```
