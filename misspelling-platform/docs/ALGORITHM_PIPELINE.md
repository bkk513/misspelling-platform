# ALGORITHM_PIPELINE.md (M13)

## Scope

This milestone service-enables three analysis tasks:

- `pcmci-causal`
- `mrnmr-steady`
- `deltaT-null`

The implementation is an internal rewrite aligned with paper logic and the public repository `bkk513/misspelling_behaviors`.

## Source Traceability

- Source repo: `https://github.com/bkk513/misspelling_behaviors`
- Source commit reference in result provenance: `4e781ec`
- Runtime provenance fields are written in `tasks.result_json.provenance`.

## Pipeline Architecture

```text
POST /api/tasks/{algo}
  -> task_service inserts QUEUED task
  -> Celery worker picks task
  -> dataset_builder builds T x N matrix from GBNC/time_series
  -> algo adapter executes (PCMCI | MRNMR | DeltaT)
  -> artifact_service writes result.csv + result.json
  -> task_artifacts rows are persisted
  -> tasks.status SUCCESS/FAILURE and task_events lifecycle rows persisted
```

Code anchors:

- Dataset builder: `backend/app/algos/dataset_builder.py`
- Adapters: `backend/app/algos/pcmci_adapter.py`, `backend/app/algos/mrnmr_adapter.py`, `backend/app/algos/deltat_adapter.py`
- Celery execution: `backend/app/tasks/__init__.py`
- API entry: `backend/app/api/routes_tasks.py`
- Task creation and owner binding: `backend/app/services/task_service.py`

## Unified Input Schema

Common baseline params for all three tasks:

- `word`
- `variants[]`
- `start_year`, `end_year`
- `corpus`
- `smoothing`

Task-specific params:

- `pcmci-causal`: `tau_max`, `alpha_level`, `pc_alpha`
- `mrnmr-steady`: `tipping_index`, `kde_bandwidth`, `poly_degree`
- `deltaT-null`: `bootstrap_samples`, `event_threshold_quantile`, `random_seed`

## Unified Result Envelope

Each algorithm task returns this envelope inside `tasks.result_json`:

- `summary`: key metrics for quick display
- `provenance`: source repo, commit, data source, mode, fallback reason
- `artifacts`: download links (`result.csv`, `result.json`)
- `warnings`: non-fatal warnings list
- preview rows by task type:
  - `top_edges` for PCMCI
  - `metrics_preview` for MR/NMR
  - `events_preview` for DeltaT

## Fallback and Strict Mode

Default mode (`ALGO_STRICT_MODE=false`):

- Runtime failure does **not** break the demo chain.
- Task completes with `SUCCESS`, warning list, and `provenance.mode=stub`.

Strict mode (`ALGO_STRICT_MODE=true`):

- Runtime failure marks task `FAILURE`.

This keeps acceptance stable while allowing strict behavior in validation environments.

## Artifact Contract

All three tasks persist at least:

- `/api/files/{task_id}/result.csv`
- `/api/files/{task_id}/result.json`

Artifact rows are persisted in `task_artifacts` with owner binding.

## Frontend Modules

Researcher console pages:

- `/app/causal-network`
- `/app/steady-state`
- `/app/delta-t-bias`

Task details page (`/app/tasks/{task_id}`) renders algorithm-specific summary/preview blocks.
