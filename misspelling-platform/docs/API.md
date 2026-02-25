# API (M3 minimal notes)

## Existing Endpoints (unchanged contract)

- `GET /health`
- `POST /api/tasks/word-analysis?word=...`
- `POST /api/tasks/simulation-run?n=...&steps=...`
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/events` (M4 added, read-only)
- `GET /api/files/{task_id}/{filename}`

M3 does not change their paths or response field compatibility.

## New Read-only Endpoints (M3, optional for validation/demo)

### `GET /api/time-series/{task_id}`

Returns stub timeseries metadata generated for a task (if present).

Example fields:

- `task_id`
- `source`
- `word`
- `granularity`
- `variants`
- `point_count`
- `items[]` (per-series summary rows)

### `GET /api/time-series/{task_id}/points?variant=correct`

Returns points for a task/variant pair.

Example fields:

- `task_id`
- `variant`
- `series_id`
- `items[]` where each item has:
  - `time` (`YYYY-MM-DD`)
  - `value` (`float`)

## M3 Stub Persistence Notes

- No external network calls are made.
- Stub data is deterministic by `task_id` (seeded).
- Task linkage to `time_series` is stored in `time_series.meta_json.task_id` (schema has no `time_series.task_id` column).

## M4 Task Events (read-only)

### `GET /api/tasks/{task_id}/events?limit=200`

Returns lifecycle events written to `task_events` for the task.

Example fields:

- `task_id`
- `items[]`
  - `event_type` (`QUEUED` / `RUNNING` / `SUCCESS` / `FAILURE`)
  - `message`
  - `meta` (JSON or `null`)
  - `created_at` (from `task_events.ts`)

Notes:

- M4 keeps existing task endpoints and response fields unchanged.
- `task_events.level` stores lifecycle event type values to reuse the fixed M2 schema.
