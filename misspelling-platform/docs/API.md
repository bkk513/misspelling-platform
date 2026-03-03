# API.md (M12)

## Compatibility Statement

The following legacy contracts remain backward-compatible:

- `GET /health`
- `POST /api/tasks/word-analysis`
- `POST /api/tasks/simulation-run`
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/files/{task_id}/{filename}`

New fields were added, old semantics were not removed.

## Auth

- `GET /api/auth/captcha`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

## Health and Diagnostics

- `GET /health` (public)
- `GET /api/health/extended` (public)
- `GET /api/admin/diagnostics` (admin)

## Tasks and Artifacts

- `POST /api/tasks/word-analysis?word=&start_year=&end_year=&smoothing=&corpus=&variants=`
- `POST /api/tasks/simulation-run?n=&steps=`
- `GET /api/tasks?limit=&scope=`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/events`
- `GET /api/tasks/{task_id}/artifacts`
- `POST /api/tasks/{task_id}/retry`
- `DELETE /api/tasks/{task_id}`
- `POST /api/tasks/bulk-delete`
- `GET /api/files/{task_id}/{filename}`

## Time Series

- `GET /api/time-series/{task_id}`
- `GET /api/time-series/{task_id}/points?variant=`
- `GET /api/time-series?limit=&scope=`
- `POST /api/time-series/bulk-delete`

## Lexicon and Dictionary

- `POST /api/lexicon/variants/suggest?word=&k=`
- `POST /api/lexicon/term/enrich?word=`
- `GET /api/lexicon/terms?limit=&q=`
- `GET /api/lexicon/{term_id}`

## GBNC Data Pull

- `POST /api/data/gbnc/pull?word=&start_year=&end_year=&corpus=&smoothing=&variants=`
- `GET /api/data/gbnc/series/{series_id}`
- `GET /api/data/gbnc/series/{series_id}/points?variant=`

## Projects and Analytics

- `POST /api/projects`
- `GET /api/projects?limit=&scope=`
- `POST /api/projects/{project_id}/terms`
- `GET /api/projects/{project_id}/terms`
- `POST /api/projects/{project_id}/tasks/bind`
- `GET /api/projects/{project_id}/tasks`
- `POST /api/analytics/cluster`
- `GET /api/analytics/summary?project_id=`

## Reports

- `POST /api/reports/export/task/{task_id}`
- `POST /api/reports/export/project/{project_id}`
- `GET /api/reports?limit=&scope=`
- `GET /api/reports/{report_id}`

## Admin

- `GET /api/admin/users?limit=`
- `POST /api/admin/users`
- `PATCH /api/admin/users/{user_id}`
- `POST /api/admin/users/{user_id}/reset-password`
- `GET /api/admin/audit-logs?limit=`
- `GET /api/admin/data-sources?limit=`
- `GET /api/admin/settings`
- `POST /api/admin/purge`

## Example Commands

```powershell
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/health/extended
curl -X POST "http://127.0.0.1:8000/api/tasks/word-analysis?word=internet&start_year=2018&end_year=2019&smoothing=1"
curl -X POST "http://127.0.0.1:8000/api/data/gbnc/pull?word=internet&start_year=2018&end_year=2019&corpus=eng_2019&smoothing=1"
curl http://127.0.0.1:8000/api/tasks?limit=20
curl -X POST http://127.0.0.1:8000/api/reports/export/task/<task_id>
```
