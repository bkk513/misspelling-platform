# FRONTEND.md (M7)

## Goal

Provide a minimal but complete researcher/admin demo UI for Framework v1 without changing existing backend API contracts.

## Pages

### `/` Home (Researcher Entry)

- Health status (`GET /health`)
- Suggest misspelling variants (`POST /api/lexicon/variants/suggest`)
- Create `word-analysis` task (GBNC params merged into the same form: `start_year/end_year/smoothing/corpus`)
- Select variants (LLM/cache suggestions + manual add/remove) before running word-analysis
- Create `simulation-run` task
- Recent task list (`GET /api/tasks`)
- Jump to task detail page
- Delete completed tasks (`DELETE /api/tasks/{task_id}`)

### `/tasks/{task_id}` Task Detail

- Polling task state (`GET /api/tasks/{task_id}`) every 2s, auto-stop after 60s
- Task lifecycle events (`GET /api/tasks/{task_id}/events`) if enabled
- Artifacts preview/download (`/api/files/{task_id}/result.csv`, `/preview.png`)
- Time series metadata/points (`GET /api/time-series/{task_id}`, `/points`)
- Multi-line variant chart (default top 6 variants, optional expand)

### `/admin` Admin (Role-Based Login)

- Username/password login (`/api/auth/login`) and admin role check (`/api/auth/me`)
- Audit log viewer (`GET /api/admin/audit-logs`)
- Users management (create user, reset password, enable/disable)
- GBNC pull records viewer (`GET /api/admin/gbnc-series`)

## Local start (PowerShell)

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1

Set-Location .\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Frontend environment

- `VITE_API_BASE` (optional, default `http://127.0.0.1:8000`)
- `ADMIN_TOKEN` is not read by frontend automatically; paste it in the Admin page input when configured on backend.

Example:

```powershell
Set-Location .\misspelling-platform\frontend
$env:VITE_API_BASE="http://127.0.0.1:8000"
npm run dev
```

## Backend environment (M7 demo-related)

- `BAILIAN_API_KEY` (optional; if absent, lexicon suggest uses cache/heuristic fallback)
- `BAILIAN_BASE_URL` (optional)
- `BAILIAN_MODEL` (optional)
- `ADMIN_TOKEN` (optional; if unset, admin auth is disabled for local demo)

## Demo flow (3 steps)

1. On Home page, click `Suggest Variants` for `demo`, then click `Run Word Analysis` (or `Simulation Run`) and open the created task.
2. In Task Detail, observe `Task Lifecycle` (`QUEUED -> RUNNING -> SUCCESS`) and the multi-line `Time Series` plot.
3. Verify `Artifacts` downloads work (`result.csv`; for `simulation-run`, also `preview.png`), use hover tooltip/legend toggle in `Time Series`, then open `/admin` to inspect users/audit logs.

## Error handling notes

- `404`: feature not enabled or task data/artifact not generated yet.
- `500`: backend exception; inspect `docker compose logs api` and `docker compose logs worker`.

## Screenshots (placeholders)

- `docs/screenshots/m7-home-variants.png` (to be added)
- `docs/screenshots/m7-task-detail-timeseries.png` (to be added)
- `docs/screenshots/m7-admin-audit-logs.png` (to be added)

## API compatibility

- Existing backend endpoint paths/response compatibility are preserved.
- M7 adds new read/write demo endpoints under `/api/lexicon/*` and `/api/admin/*` only.
