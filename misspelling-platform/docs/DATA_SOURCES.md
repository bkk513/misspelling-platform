# DATA_SOURCES.md (M12)

## Runtime Health

- Legacy: `GET /health` (`status`, `db`) unchanged.
- Extended: `GET /api/health/extended` adds `redis`, `worker`, `llm_enabled`, `gbnc_enabled`, and per-component diagnostics.
- Admin diagnostics: `GET /api/admin/diagnostics` (admin-only) adds config fingerprint, last pull summary, and recent audit rows.

## LLM Provider (DashScope-compatible)

Env priority:

- `DASHSCOPE_API_KEY` (preferred)
- `BAILIAN_API_KEY` (fallback)

Other env:

- `BAILIAN_BASE_URL` (default `https://dashscope.aliyuncs.com/compatible-mode/v1`)
- `BAILIAN_MODEL` (default `qwen-plus`)
- `BAILIAN_TIMEOUT_SECONDS`

Behavior:

- LLM recommend API: `POST /api/lexicon/variants/suggest`.
- Failures degrade to heuristic variants.
- Audit writes provider/model/latency/ok/error (no secret logged).

## GBNC Data Source

Integration:

- `backend/app/integrations/gbnc/client.py`
- `backend/app/integrations/gbnc/parser.py`

API:

- `POST /api/data/gbnc/pull`
- `GET /api/data/gbnc/series/{series_id}`
- `GET /api/data/gbnc/series/{series_id}/points`

Word-analysis pipeline also uses GBNC pull internally and writes provenance in task result.

Env:

- `GBNC_BASE_URL` (default Google Ngram JSON endpoint)
- `GBNC_TIMEOUT_SECONDS`
- `GBNC_RETRIES`
- `GBNC_USER_AGENT`

## Fallback and Cache Policy

1. Cache probe by `(word, variants, year range, corpus, smoothing, owner scope)`.
2. Cache hit => reuse existing series and log `DATA_PULL_GBNC_CACHE_HIT`.
3. Cache miss => pull GBNC.
4. If network/parsing/provider fails => fallback `source=STUB` with warning and explicit `error_reason`.
5. All pulls emit audit logs (`DATA_PULL_GBNC`, `DATA_PULL_GBNC_IMPORT`).

## Traceability

Persisted entities:

- `data_sources`
- `time_series`
- `time_series_points`
- `tasks` / `task_events` / `task_artifacts`
- `audit_logs`

Each task/report can be traced to:

- input params
- source and warnings
- generated points count
- output artifacts (csv/png/html)
