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

## M5 Artifacts (compatible extension)

`simulation-run` continues to use the existing task endpoints and file download route, while now generating:

- `result.csv`
- `preview.png`

Downloads are still served via:

- `GET /api/files/{task_id}/result.csv`
- `GET /api/files/{task_id}/preview.png`

`word-analysis` (M7) also writes `result.csv` and reuses the same download route.

## M7 Lexicon / LLM Variant Suggestion

M7 adds lexicon/variant endpoints without changing any existing endpoint paths or response compatibility.

### `POST /api/lexicon/variants/suggest?word=...&k=...`

Returns cached or LLM-suggested misspelling variants for a term and persists them into lexicon tables.

Example fields:

- `word`
- `term_id`
- `variants[]`
- `source` (`"cache"` / `"llm"`)
- `version_id`
- `llm_enabled` (`bool`)
- `warning` (`string|null`, optional when LLM is disabled/empty)

Notes:

- LLM provider is env-driven (`BAILIAN_*` vars).
- If `BAILIAN_API_KEY` is not configured, endpoint still works via cache/heuristic fallback.

### `GET /api/lexicon/terms?limit=20`

Returns lexicon term list for demo/admin browsing.

Example fields:

- `items[]`
  - `id`
  - `canonical`
  - `category`
  - `created_at`

### `GET /api/lexicon/{term_id}/variants`

Returns variants for the given lexicon term.

Example fields:

- `term_id`
- `items[]`
  - `id`
  - `variant`
  - `variant_type`
  - `source`
  - `version_id`

## M7 Admin (weak auth demo)

M7 adds a minimal admin API protected by a simple header token.

Auth rule:

- Header: `X-Admin-Token`
- Env: `ADMIN_TOKEN`
- If `ADMIN_TOKEN` is empty/unset, auth is treated as disabled for local demo convenience.

### `GET /api/admin/audit-logs?limit=100`

Returns recent `audit_logs` rows for operational/demo visibility.

Example fields:

- `items[]`
  - `id`
  - `action`
  - `target_type`
  - `target_id`
  - `meta`
  - `created_at`

### `POST /api/admin/lexicon/variants`

Manually append variants to a term for demo/admin curation.

Request body (JSON):

- `word` (optional if `term_id` provided)
- `term_id` (optional if `word` provided)
- `variants[]` (required)

Response fields:

- `ok`
- `term_id`
- `version_id`
- `count`
- `variants[]`
