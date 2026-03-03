# FRONTEND.md (M12 Enterprise UI)

## Stack

- React + Vite + TypeScript
- Ant Design component system
- Single backend API base: `VITE_API_BASE` (default `http://127.0.0.1:8000`)

## Layouts

- `ResearcherLayout` for `/app/*`
- `AdminLayout` for `/admin/*`
- `Login` at `/login`

Header includes user/role + environment badges (DB/LLM/GBNC).

## Researcher Modules

- `/app/dashboard`
- `/app/tasks`
- `/app/tasks/{task_id}`
- `/app/word-analysis`
- `/app/variants`
- `/app/projects`
- `/app/analytics`
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

## Session Consistency

- Login/logout remounts module content by session-derived key.
- Prevents transient stale data from previous identity.
- Task detail polling can be paused/resumed and interval switched.

## Local Run

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1

Set-Location .\frontend
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`.

## Key UX Flows

1. Login/Register (captcha on register), then open dashboard.
2. Word Analysis Workbench:
   - set GBNC params + variants
   - optional GBNC preview pull
   - run task and jump detail
3. Task Detail:
   - lifecycle events
   - artifacts download
   - retry task
   - export HTML report
4. Project Manager + Analytics:
   - create project
   - add terms, bind tasks
   - run baseline clustering
5. Admin console:
   - users / audit logs / data sources / settings / diagnostics visibility
