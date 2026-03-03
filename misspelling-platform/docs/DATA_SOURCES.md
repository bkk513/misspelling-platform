# DATA_SOURCES.md (M13)

## Runtime Health

- Legacy: `GET /health` (`status`, `db`) unchanged.
- Extended: `GET /api/health/extended` adds `redis`, `worker`, `llm_enabled`, `gbnc_enabled`, and warnings.
- Admin diagnostics: `GET /api/admin/diagnostics` (admin-only) returns config fingerprint and recent audit rows.

## LLM Provider (DashScope-compatible)

Env priority:

- `DASHSCOPE_API_KEY` (preferred)
- `BAILIAN_API_KEY` (fallback)

Other env:

- `BAILIAN_BASE_URL` (default `https://dashscope.aliyuncs.com/compatible-mode/v1`)
- `BAILIAN_MODEL` (default `qwen-plus`)
- `BAILIAN_TIMEOUT_SECONDS`

Behavior:

- `POST /api/lexicon/variants/suggest` returns `source=llm|cache|heuristic`.
- Failures degrade to heuristic variants with warnings.
- Audit logs persist provider/model/latency/ok/error (no secret material).

## GBNC Data Source

Integration modules:

- `backend/app/integrations/gbnc/client.py`
- `backend/app/integrations/gbnc/parser.py`

API:

- `POST /api/data/gbnc/pull`
- `GET /api/data/gbnc/series/{series_id}`
- `GET /api/data/gbnc/series/{series_id}/points`

Word-analysis and M13 algorithm tasks both read from the same GBNC/time-series path.

Env:

- `GBNC_BASE_URL` (default Google Ngram JSON endpoint)
- `GBNC_TIMEOUT_SECONDS`
- `GBNC_RETRIES`
- `GBNC_USER_AGENT`

## Algorithm Data Dependency (M13)

Algorithm tasks:

- `pcmci-causal`
- `mrnmr-steady`
- `deltaT-null`

All use `dataset_builder`:

1. Pull GBNC data (or fallback) through `pull_gbnc_with_fallback`.
2. Persist into `time_series` / `time_series_points`.
3. Rebuild aligned matrix (year axis + variants) for adapters.

Code anchors:

- `backend/app/algos/dataset_builder.py`
- `backend/app/tasks/__init__.py`

## Fallback and Strict Policy

Default (`ALGO_STRICT_MODE=false`):

- Errors degrade to `SUCCESS + warnings + provenance.mode=stub`.

Strict (`ALGO_STRICT_MODE=true`):

- Adapter failure escalates to `FAILURE`.

This keeps acceptance stable while allowing strict validation mode.

## Provenance and Traceability

For algorithm tasks, `tasks.result_json.provenance` includes:

- `source_repo`
- `source_repo_commit`
- `impl`
- `dataset_source`
- `mode`
- `fallback_reason`
- `params`

Artifacts are persisted in `task_artifacts` and downloaded via `/api/files/{task_id}/{filename}`.

## Cache Policy (GBNC)

1. Check signature cache by word/variants/year-range/corpus/smoothing/owner scope.
2. Cache hit -> reuse rows and log `DATA_PULL_GBNC_CACHE_HIT`.
3. Cache miss -> pull GBNC and persist.
4. If pull fails -> fallback STUB with warning and `error_reason`.
