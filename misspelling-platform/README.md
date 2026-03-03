# Misspelling Platform (M12 Enterprise Acceptance)

## Quick Start

```powershell
Set-Location .\misspelling-platform
docker compose up -d --build
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

## Frontend

```powershell
Set-Location .\misspelling-platform\frontend
npm install
npm run dev
```

Default URL: `http://127.0.0.1:5173`

## Required Environment Variables

- `DATABASE_URL` (compose already injects service defaults)
- `REDIS_URL` (compose default)
- `AUTH_TOKEN_SECRET`
- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

Optional:

- `DASHSCOPE_API_KEY` or `BAILIAN_API_KEY`
- `BAILIAN_BASE_URL`
- `BAILIAN_MODEL`
- `GBNC_BASE_URL`
- `GBNC_TIMEOUT_SECONDS`
- `GBNC_RETRIES`
- `GBNC_USER_AGENT`

## Acceptance

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

Expected:

- compose build/up success
- `/health` with `db:true`
- schema detected
- word-analysis success
- simulation-run success + CSV/PNG downloadable
- M12 warn checks for extended health/admin diagnostics/GBNC pull

## Docs

- `docs/API.md`
- `docs/DB_SCHEMA.md`
- `docs/AUTH.md`
- `docs/DATA_SOURCES.md`
- `docs/FRONTEND.md`
- `docs/M12_DEMO.md`
