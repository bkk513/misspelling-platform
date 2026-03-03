# FRONTEND.md (M13)

## Stack

- React + Vite + TypeScript
- Ant Design component system
- Single backend API base: `VITE_API_BASE` (default `http://127.0.0.1:8000`)

## Layouts

- `ResearcherLayout` for `/app/*`
- `AdminLayout` for `/admin/*`
- `Login` at `/login`

Header badges show DB/LLM/GBNC runtime status.

## Researcher Modules

- `/app/dashboard`
- `/app/tasks`
- `/app/tasks/{task_id}`
- `/app/word-analysis`
- `/app/variants`
- `/app/projects`
- `/app/analytics`
- `/app/causal-network` (new)
- `/app/steady-state` (new)
- `/app/delta-t-bias` (new)
- `/app/time-series`
- `/app/artifacts`
- `/app/reports`
- `/app/settings`

## Admin Modules

- `/admin/dashboard`
- `/admin/users`
- `/admin/audit-logs`
- `/admin/data-sources`
- `/admin/settings`

Admin routes require admin bearer token.

## M13 Algorithm Pages

### Causal Network (`/app/causal-network`)

- Parameter form: word + year window + smoothing + tau/alpha + variants.
- Create task via `POST /api/tasks/pcmci-causal`.
- Preview table loads `result.top_edges` from task detail payload.

### Steady State (`/app/steady-state`)

- Parameter form for MR/NMR.
- Create task via `POST /api/tasks/mrnmr-steady`.
- Preview table loads `result.metrics_preview`.

### DeltaT Bias (`/app/delta-t-bias`)

- Parameter form for bootstrap/null settings.
- Create task via `POST /api/tasks/deltaT-null`.
- Preview table loads `result.events_preview`.

## Task Detail Enhancements

`/app/tasks/{task_id}` now renders algorithm-specific panel when task type is:

- `pcmci-causal`
- `mrnmr-steady`
- `deltaT-null`

Panel shows:

- summary
- provenance
- warnings
- algorithm preview rows
- `result.csv` and `result.json` artifact checks

## Local Run

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1

Set-Location .\frontend
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`.
