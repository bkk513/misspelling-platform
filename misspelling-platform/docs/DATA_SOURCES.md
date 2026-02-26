# DATA_SOURCES.md (M8)

## Overview

M8 adds a real external data path for Google Books Ngram Viewer (GBNC) while keeping the existing stub time-series path for offline demos.

Current sources in v1:

- `stub_local` (existing deterministic demo source used by task stubs)
- `gbnc` (Google Books Ngram Viewer JSON endpoint)

## GBNC Integration

### Source

- Product: Google Books Ngram Viewer (GBNC)
- Endpoint used by M8 adapter: `https://books.google.com/ngrams/json`
- Upstream page (reference): `https://books.google.com/ngrams`

### Why JSON endpoint

Older scripts (including the vendored `legacy_getNgrams.py`) parse HTML from `/ngrams/graph`.
M8 keeps that script for provenance/reference but uses the JSON endpoint for runtime reliability.

### Request parameters (M8)

The adapter function `fetch_gbnc_series(...)` and API `/api/data/gbnc/pull` use:

- `content` (comma-separated query terms / variants)
- `year_start`
- `year_end`
- `corpus` (mapped to numeric GBNC corpus id)
- `smoothing`

Example (conceptual):

`/ngrams/json?content=internet,internett&year_start=2018&year_end=2019&corpus=26&smoothing=0`

### Runtime output shape (adapter)

`backend/app/integrations/gbnc/client.py` returns a normalized structure:

- `source`
- `provider`
- `unit`
- `term`
- `variants[]`
- `corpus`
- `smoothing`
- `start_year`
- `end_year`
- `request_url`
- `query`
- `series[]`
  - `variant`
  - `points[]`
    - `year`
    - `value`

### Parser compatibility

`backend/app/integrations/gbnc/parser.py` supports:

- direct JSON list response (`/ngrams/json`)
- legacy HTML/embedded JSON fragments (fallback parser path)

## Persistence / Traceability

M8 GBNC pull persistence writes:

- `data_sources` (`name='gbnc'`, granularity=`year`)
- `time_series` (one row per term/variant)
- `time_series_points` (yearly points)
- `audit_logs` (`GBNC_PULL_SUCCESS`, `GBNC_CACHE_HIT`, or error entries)

Trace fields in `time_series.meta_json` include:

- `gbnc=true`
- `provider`
- `gbnc_cache_key` (acts as reproducibility/cache key)
- `term`
- `variant`
- `corpus`
- `smoothing`
- `query`
- `request_url`

## Cache behavior

M8 cache key is derived from:

- term
- variant
- `start_year`
- `end_year`
- `corpus`
- `smoothing`

If all requested variants for the same parameter set already exist with points, the service reuses existing rows and writes `GBNC_CACHE_HIT` audit log.

## Known limits (M8)

- Some modern words (e.g. very new proper nouns) may return no points for selected ranges.
- GBNC coverage varies by corpus and publication lag.
- Network restrictions or upstream throttling may fail pulls; M8 surfaces this via API errors and audit logs.
- M8 API is currently synchronous for `/api/data/gbnc/pull` (no Celery task wrapper yet).

## Vendored script provenance

M8 vendors the original script (for reference/adaptation provenance):

- `backend/app/integrations/gbnc/legacy_getNgrams.py`

It is not the runtime path used by the new service, but it documents the original query model and corpus mapping source used during integration.

