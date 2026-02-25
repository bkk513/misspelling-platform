# FRONTEND.md (M6)

## Goal

Provide a minimal but complete researcher demo UI for Framework v1 without changing existing backend API contracts.

## Pages

### `/` Home (Researcher Entry)

- Health status (`GET /health`)
- Create `word-analysis` task
- Create `simulation-run` task
- Recent task list (`GET /api/tasks`)
- Jump to task detail page

### `/tasks/{task_id}` Task Detail

- Polling task state (`GET /api/tasks/{task_id}`) every 2s, auto-stop after 60s
- Task lifecycle events (`GET /api/tasks/{task_id}/events`) if enabled
- Artifacts preview/download (`/api/files/{task_id}/result.csv`, `/preview.png`)
- Time series metadata/points (`GET /api/time-series/{task_id}`, `/points`)

## Local start (PowerShell)

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1

Set-Location .\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Demo flow (3 steps)

1. On Home page, create `simulation-run` with default `n=20`, `steps=15`.
2. Open Task Detail and watch `Task Lifecycle` move to `SUCCESS`.
3. Verify `preview.png` preview renders and `result.csv` / `preview.png` download links work.

## Error handling notes

- `404`: feature not enabled or task data/artifact not generated yet.
- `500`: backend exception; inspect `docker compose logs api` and `docker compose logs worker`.

## Screenshots (placeholders)

- `docs/screenshots/m6-home.png` (to be added)
- `docs/screenshots/m6-task-detail-success.png` (to be added)
- `docs/screenshots/m6-task-detail-timeseries.png` (to be added)

## API compatibility

- No backend endpoint paths were changed in M6.
- No new backend API endpoint was added in M6.
