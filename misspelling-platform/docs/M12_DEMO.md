# M12_DEMO.md

## 0. Environment Prep

Set env variables before `docker compose up`:

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`
- `AUTH_TOKEN_SECRET`
- Optional LLM:
  - `DASHSCOPE_API_KEY` (or `BAILIAN_API_KEY`)
  - `BAILIAN_BASE_URL`
  - `BAILIAN_MODEL`
- Optional GBNC tuning:
  - `GBNC_BASE_URL`
  - `GBNC_TIMEOUT_SECONDS`
  - `GBNC_RETRIES`

Run baseline acceptance:

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

## 1. Login / Register / Captcha

1. Open `/login`.
2. Switch to `Register`, call captcha, register a new user.
3. Auto-login redirects to `/app/dashboard`.

Expected:

- guest/user/admin state change is immediate.
- no stale task list from previous identity.

## 2. Word Analysis + Provenance

1. Open `/app/word-analysis`.
2. Input `word`, `start_year`, `end_year`, `smoothing`, optional variants.
3. Click `Run Word Analysis`.

Expected:

- task created and detail page opens.
- result JSON includes `provenance` with source (`GBNC` or `STUB`) and warnings/error reason.
- `result.csv` downloadable.

## 3. Task Lifecycle + Retry + Report

On `/app/tasks/{task_id}`:

1. Observe events: `QUEUED -> RUNNING -> SUCCESS`.
2. Use `Refresh Now`, `Stop/Resume Auto Refresh`, interval selector.
3. Click `Retry Task` and verify new task id/lineage.
4. Click `Export Report` and open generated HTML artifact.

## 4. GBNC Data Pull API

Call:

```powershell
curl -X POST "http://127.0.0.1:8000/api/data/gbnc/pull?word=internet&start_year=2018&end_year=2019&corpus=eng_2019&smoothing=1"
```

Expected:

- cache hit/miss state returned.
- series id(s) returned.
- `/api/data/gbnc/series/{series_id}` and `/points` queryable.

## 5. Projects + Analytics

1. Open `/app/projects`, create project.
2. Add terms and bind tasks.
3. Open `/app/analytics`, run clustering.

Expected:

- summary and cluster results visible.
- analytics run persisted.

## 6. Admin Console

1. Login as admin, open `/admin/dashboard`.
2. Check user management, audit logs, data sources.
3. Call diagnostics:
   - UI cards in admin pages
   - API `GET /api/admin/diagnostics`

Expected:

- admin-only routes protected.
- diagnostics show db/redis/worker/llm/gbnc status and warnings.

## 7. Artifact and Report Verification

Verify download URLs return 200:

- `/api/files/{task_id}/result.csv`
- `/api/files/{task_id}/preview.png` (simulation)
- `/api/files/{task_id}/{report_filename}.html`

## 8. Screenshot Checklist

- `docs/screenshots/m12-login-register-captcha.png`
- `docs/screenshots/m12-word-analysis-provenance.png`
- `docs/screenshots/m12-task-detail-events-retry-report.png`
- `docs/screenshots/m12-project-manager.png`
- `docs/screenshots/m12-analytics-cluster.png`
- `docs/screenshots/m12-admin-diagnostics.png`
