import json
import os
import time
from typing import Any, Callable

from celery.signals import task_failure, task_success

from ..algos import (
    build_algorithm_dataset,
    run_delta_t,
    run_mrnmr,
    run_pcmci,
    to_edge_rows,
    to_event_rows,
    to_metric_rows,
)
from ..celery_app import celery_app
from ..db.tasks_repo import set_task_failure, set_task_running, set_task_success
from ..services.artifact_service import (
    build_output_dir,
    register_artifact,
    register_simulation_artifacts,
    register_word_analysis_artifact,
    write_delta_t_preview_png,
    write_json_file,
    write_mrnmr_preview_png,
    write_pcmci_preview_png,
    write_pcmci_window_network_png,
    write_pcmci_window_timeseries_png,
    write_rows_csv,
    write_simulation_csv,
    write_simulation_preview_png,
    write_word_analysis_csv,
)
from ..services.gbnc_service import build_provenance, pull_gbnc_with_fallback
from ..services.task_event_service import (
    record_task_failure,
    record_task_running,
    record_task_success,
)
from ..services.timeseries_service import (
    persist_simulation_stub_timeseries,
    persist_word_analysis_external_series,
)

ALGO_SOURCE_REPO = "https://github.com/bkk513/misspelling_behaviors"
ALGO_SOURCE_COMMIT = "4e781ec"
ALGO_IMPL = "internal_rewrite"


def _word_params(payload: str | dict):
    if isinstance(payload, dict):
        word = str(payload.get("word") or "demo")
        variants = [str(v).strip().lower() for v in (payload.get("variants") or []) if str(v).strip()]
        return {
            "word": word,
            "start_year": int(payload.get("start_year") or 1900),
            "end_year": int(payload.get("end_year") or 2019),
            "smoothing": int(payload.get("smoothing") or 3),
            "corpus": str(payload.get("corpus") or "eng_2019"),
            "variants": variants,
        }
    return {
        "word": str(payload or "demo"),
        "start_year": 1900,
        "end_year": 2019,
        "smoothing": 3,
        "corpus": "eng_2019",
        "variants": [],
    }


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _to_optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _unique_variants(word: str, values: Any) -> list[str]:
    out: list[str] = []
    canonical = str(word or "").strip().lower()
    if canonical:
        out.append(canonical)
    if isinstance(values, str):
        values = [v.strip() for v in values.split(",") if v.strip()]
    for raw in values or []:
        item = str(raw or "").strip().lower()
        if item and item not in out:
            out.append(item)
    return out


def _algo_params(payload: dict[str, Any] | Any) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {"word": str(payload or "demo")}
    word = str(data.get("word") or "demo").strip().lower() or "demo"
    return {
        "word": word,
        "variants": _unique_variants(word, data.get("variants") or []),
        "start_year": _to_int(data.get("start_year"), 1900),
        "end_year": _to_int(data.get("end_year"), 2019),
        "corpus": str(data.get("corpus") or "eng_2019"),
        "smoothing": _to_int(data.get("smoothing"), 3),
        "tau_max": _to_int(data.get("tau_max"), 8),
        "window_size": _to_int(data.get("window_size"), 0),
        "window_step": _to_int(data.get("window_step"), 0),
        "alpha_level": _to_float(data.get("alpha_level"), 0.01),
        "pc_alpha": _to_optional_float(data.get("pc_alpha")),
        "tipping_index": _to_int(data.get("tipping_index"), 0),
        "kde_bandwidth": str(data.get("kde_bandwidth") or "scott"),
        "poly_degree": _to_int(data.get("poly_degree"), 20),
        "bootstrap_samples": _to_int(data.get("bootstrap_samples"), 500),
        "event_threshold_quantile": _to_float(data.get("event_threshold_quantile"), 0.9),
        "random_seed": _to_int(data.get("random_seed"), 42),
    }


def _algo_strict_mode() -> bool:
    return str(os.getenv("ALGO_STRICT_MODE", "false")).strip().lower() in {"1", "true", "yes", "on"}


def _merge_warnings(*items: Any) -> list[str]:
    warnings: list[str] = []
    for part in items:
        if not part:
            continue
        if isinstance(part, list):
            for raw in part:
                msg = str(raw)
                if msg and msg not in warnings:
                    warnings.append(msg)
        else:
            msg = str(part)
            if msg and msg not in warnings:
                warnings.append(msg)
    return warnings


def _build_algo_provenance(
    task_id: str,
    task_type: str,
    dataset_source: str,
    mode: str,
    params: dict[str, Any],
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "task_type": task_type,
        "source_repo": ALGO_SOURCE_REPO,
        "source_repo_commit": ALGO_SOURCE_COMMIT,
        "impl": ALGO_IMPL,
        "dataset_source": dataset_source,
        "mode": mode,
        "fallback_reason": fallback_reason,
        "params": params,
    }


def _save_algo_artifacts(
    task_id: str,
    result_rows: list[dict[str, Any]],
    result_json: dict[str, Any],
    fieldnames: list[str],
) -> dict[str, str]:
    out_dir = build_output_dir(task_id)
    csv_path = out_dir / "result.csv"
    json_path = out_dir / "result.json"
    write_rows_csv(result_rows, csv_path, fieldnames=fieldnames)
    write_json_file(result_json, json_path)
    register_artifact(task_id, "csv", "result.csv", csv_path, "text/csv")
    register_artifact(task_id, "json", "result.json", json_path, "application/json")
    return {
        "csv": f"/api/files/{task_id}/result.csv",
        "json": f"/api/files/{task_id}/result.json",
    }


def _try_save_algo_preview(
    task_id: str,
    task_type: str,
    algo_payload: dict[str, Any],
) -> tuple[str | None, str | None]:
    try:
        out_dir = build_output_dir(task_id)
        out_png = out_dir / "preview.png"
        if task_type == "pcmci-causal":
            write_pcmci_preview_png(algo_payload.get("edges") or [], out_png)
            for window in algo_payload.get("window_results") or []:
                network_png = str(window.get("network_png") or "").strip()
                timeseries_png = str(window.get("timeseries_png") or "").strip()
                if network_png:
                    network_path = out_dir / network_png
                    write_pcmci_window_network_png(window, network_path)
                    register_artifact(task_id, "png", network_png, network_path, "image/png")
                if timeseries_png:
                    ts_path = out_dir / timeseries_png
                    write_pcmci_window_timeseries_png(window, ts_path)
                    register_artifact(task_id, "png", timeseries_png, ts_path, "image/png")
        elif task_type == "mrnmr-steady":
            write_mrnmr_preview_png(algo_payload.get("metrics") or [], algo_payload.get("summary") or {}, out_png)
        elif task_type == "deltaT-null":
            write_delta_t_preview_png(algo_payload.get("events") or [], algo_payload.get("delta_t_stats") or {}, out_png)
        else:
            return None, None
        register_artifact(task_id, "png", "preview.png", out_png, "image/png")
        return f"/api/files/{task_id}/preview.png", None
    except Exception as exc:
        return None, f"preview_generation_failed:{exc}"


def _build_stub_result(
    task_id: str,
    task_type: str,
    params: dict[str, Any],
    warning: str,
) -> dict[str, Any]:
    result_payload = {
        "summary": {"mode": "stub", "reason": warning},
        "warnings": [warning],
    }
    artifacts = _save_algo_artifacts(
        task_id=task_id,
        result_rows=[{"message": warning}],
        result_json=result_payload,
        fieldnames=["message"],
    )
    return {
        "summary": result_payload["summary"],
        "provenance": _build_algo_provenance(
            task_id=task_id,
            task_type=task_type,
            dataset_source="STUB",
            mode="stub",
            params=params,
            fallback_reason=warning,
        ),
        "artifacts": artifacts,
        "warnings": [warning],
    }


def _execute_algo_task(
    task_id: str,
    task_type: str,
    params: dict[str, Any],
    runner: Callable[[Any, dict[str, Any]], dict[str, Any]],
    rows_builder: Callable[[dict[str, Any]], list[dict[str, Any]]],
    fieldnames: list[str],
    preview_key: str,
) -> dict[str, Any]:
    try:
        dataset = build_algorithm_dataset(
            task_id=task_id,
            word=params["word"],
            variants=params.get("variants") or [],
            start_year=int(params["start_year"]),
            end_year=int(params["end_year"]),
            corpus=str(params["corpus"]),
            smoothing=int(params["smoothing"]),
        )
        algo_payload = runner(dataset, params)
        warnings = _merge_warnings(dataset.warnings, algo_payload.get("warnings"))
        mode = str(algo_payload.get("mode") or dataset.mode)
        fallback_reason = dataset.fallback_reason
        rows = rows_builder(algo_payload)
        artifacts = _save_algo_artifacts(
            task_id=task_id,
            result_rows=rows,
            result_json=algo_payload,
            fieldnames=fieldnames,
        )
        preview_url, preview_warning = _try_save_algo_preview(task_id, task_type, algo_payload)
        if preview_url:
            artifacts["png"] = preview_url
        if preview_warning:
            warnings = _merge_warnings(warnings, [preview_warning])
        summary = dict(algo_payload.get("summary") or {})
        summary["rows"] = len(rows)
        result = {
            "summary": summary,
            "provenance": _build_algo_provenance(
                task_id=task_id,
                task_type=task_type,
                dataset_source=str(dataset.source).upper(),
                mode=mode,
                params=params,
                fallback_reason=fallback_reason,
            ),
            "artifacts": artifacts,
            "warnings": warnings,
            preview_key: rows[:20],
        }
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, task_type)
        return result
    except Exception as exc:
        if _algo_strict_mode():
            raise
        warning = f"algo_stub_fallback:{exc}"
        result = _build_stub_result(task_id, task_type, params, warning)
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, task_type)
        return result


@celery_app.task(bind=True)
def demo_analysis(self, payload: str | dict):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "word-analysis")
    params = _word_params(payload)
    try:
        for i in range(3):
            time.sleep(1)
            self.update_state(state="PROGRESS", meta={"step": i + 1, "total": 3})

        pulled = pull_gbnc_with_fallback(
            term=params["word"],
            variants=params["variants"],
            start_year=params["start_year"],
            end_year=params["end_year"],
            corpus=params["corpus"],
            smoothing=params["smoothing"],
        )
        persisted = persist_word_analysis_external_series(task_id, params["word"], pulled)

        csv_rows: list[dict] = []
        for item in pulled.get("series") or []:
            variant = item.get("variant") or params["word"]
            for point in item.get("points") or []:
                csv_rows.append(
                    {
                        "time": str(point.get("year")),
                        "variant": variant,
                        "value": float(point.get("value") or 0.0),
                    }
                )

        out_dir = build_output_dir(task_id)
        out_csv = out_dir / "result.csv"
        write_word_analysis_csv(csv_rows, out_csv)
        register_word_analysis_artifact(task_id, out_csv)

        provenance = build_provenance(task_id, pulled, params)
        result = {
            "word": params["word"],
            "message": "analysis done",
            "dummy_metric": 42,
            "provenance": provenance,
            "series_count": persisted["series_count"],
            "point_count": persisted["point_count"],
            "variants": persisted["variants"],
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
        }
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, "word-analysis")
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
        record_task_failure(task_id, "word-analysis", str(e))
        raise


@task_success.connect(sender=demo_analysis)
def _on_success(sender=None, result=None, **kwargs):
    task_id = kwargs.get("task_id")
    set_task_success(task_id, json.dumps(result))


@task_failure.connect(sender=demo_analysis)
def _on_failure(sender=None, exception=None, traceback=None, **kwargs):
    task_id = kwargs.get("task_id")
    set_task_failure(task_id, str(exception))


@celery_app.task(bind=True)
def simulation_run(self, n: int = 30, steps: int = 50):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "simulation-run")
    try:
        series = [{"t": t, "errors": (t % 10), "correct": (t * 2) % 17} for t in range(steps)]
        out_dir = build_output_dir(task_id)
        out_csv = out_dir / "result.csv"
        out_png = out_dir / "preview.png"
        write_simulation_csv(series, out_csv)
        write_simulation_preview_png(series, out_png)
        register_simulation_artifacts(task_id, out_csv, out_png)
        result = {
            "n": n,
            "steps": steps,
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
            "preview": series[:5],
        }
        persist_simulation_stub_timeseries(task_id, n, steps)
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, "simulation-run")
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
        record_task_failure(task_id, "simulation-run", str(e))
        raise


@celery_app.task(bind=True)
def pcmci_causal(self, payload: dict[str, Any]):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "pcmci-causal")
    params = _algo_params(payload)
    try:
        return _execute_algo_task(
            task_id=task_id,
            task_type="pcmci-causal",
            params=params,
            runner=lambda dataset, cfg: run_pcmci(
                dataset,
                tau_max=int(cfg["tau_max"]),
                alpha_level=float(cfg["alpha_level"]),
                pc_alpha=cfg.get("pc_alpha"),
                window_size=int(cfg.get("window_size") or 0),
                window_step=int(cfg.get("window_step") or 0),
            ),
            rows_builder=to_edge_rows,
            fieldnames=["source", "target", "lag", "weight", "p_value", "q_value", "method"],
            preview_key="top_edges",
        )
    except Exception as exc:
        set_task_failure(task_id, str(exc))
        record_task_failure(task_id, "pcmci-causal", str(exc))
        raise


@celery_app.task(bind=True)
def mrnmr_steady(self, payload: dict[str, Any]):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "mrnmr-steady")
    params = _algo_params(payload)
    try:
        return _execute_algo_task(
            task_id=task_id,
            task_type="mrnmr-steady",
            params=params,
            runner=lambda dataset, cfg: run_mrnmr(
                dataset,
                tipping_index=int(cfg["tipping_index"]),
                kde_bandwidth=str(cfg["kde_bandwidth"]),
                poly_degree=int(cfg["poly_degree"]),
            ),
            rows_builder=to_metric_rows,
            fieldnames=["year", "misspelling", "correct", "MR", "NMR", "density"],
            preview_key="metrics_preview",
        )
    except Exception as exc:
        set_task_failure(task_id, str(exc))
        record_task_failure(task_id, "mrnmr-steady", str(exc))
        raise


@celery_app.task(bind=True)
def deltat_null(self, payload: dict[str, Any]):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "deltaT-null")
    params = _algo_params(payload)
    try:
        return _execute_algo_task(
            task_id=task_id,
            task_type="deltaT-null",
            params=params,
            runner=lambda dataset, cfg: run_delta_t(
                dataset,
                bootstrap_samples=int(cfg["bootstrap_samples"]),
                event_threshold_quantile=float(cfg["event_threshold_quantile"]),
                random_seed=int(cfg["random_seed"]),
            ),
            rows_builder=to_event_rows,
            fieldnames=["year", "index"],
            preview_key="events_preview",
        )
    except Exception as exc:
        set_task_failure(task_id, str(exc))
        record_task_failure(task_id, "deltaT-null", str(exc))
        raise
