# Frontend (M7 Demo UI)

Minimal researcher/admin demo UI built with React + Vite + TypeScript.

## Run (PowerShell)

```powershell
Set-Location .\misspelling-platform\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Backend dependency

- Start backend/API/worker first:

```powershell
Set-Location ..\
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

The frontend calls the backend using `VITE_API_BASE` (default `http://127.0.0.1:8000`).

Optional API base override:

```powershell
$env:VITE_API_BASE="http://127.0.0.1:8000"
npm run dev
```

## M7 pages

- `/` Researcher Home
  - health
  - suggest variants (cache/LLM)
  - create `word-analysis` / `simulation-run`
  - recent tasks
- `/tasks/{task_id}` Task Detail
  - polling status + events
  - artifacts (`result.csv`, `preview.png`)
  - multi-variant time-series chart
- `/admin` Admin (weak auth demo)
  - paste `X-Admin-Token`
  - view audit logs
  - append lexicon variants

## Notes

- If `BAILIAN_API_KEY` is not configured on backend, variant suggestion still works via cache/heuristic fallback and UI shows a warning.
- `ADMIN_TOKEN` is optional; when backend leaves it empty, admin routes are available without token (local demo mode).
