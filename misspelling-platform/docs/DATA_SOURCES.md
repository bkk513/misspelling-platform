# DATA_SOURCES.md (M11)

## Overview

M11 keeps the existing task/data pipeline backward-compatible and adds stability signaling for optional external capabilities.

## Health Endpoints

- `GET /health`: legacy health contract (`status`, `db`) unchanged.
- `GET /api/health/extended`: adds runtime capabilities and warnings.

Response example:

```json
{
  "status": "ok",
  "db": true,
  "redis": true,
  "llm_enabled": false,
  "gbnc_enabled": true,
  "warnings": ["llm_key_missing"]
}
```

## Environment Variables

### LLM

- `DASHSCOPE_API_KEY` (preferred)
- `BAILIAN_API_KEY` (compatible fallback)
- `BAILIAN_BASE_URL` (default: DashScope compatible mode)
- `BAILIAN_MODEL`

### Runtime

- `REDIS_URL`
- `DATABASE_URL`

### Auth bootstrap

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

## Degradation Strategy

The platform must not fail baseline acceptance when keys/network are unavailable:

- Missing LLM key => `llm_enabled=false`, warning emitted, UI shows disabled state.
- External pull failure path should fallback to local/stub data path where available.
- `scripts/check.ps1` does not depend on external internet calls.

## Traceability

All persisted objects continue to be queryable via:

- `tasks`
- `task_events`
- `task_artifacts`
- `time_series` / `time_series_points`

M11 additionally tags ownership (`owner_user_id`) to support per-user isolation.
