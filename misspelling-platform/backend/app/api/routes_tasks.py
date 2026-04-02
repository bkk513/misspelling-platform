from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .auth_deps import get_optional_user
from ..db.core import check_db
from ..db.audit_logs_repo import insert_audit_log
from ..services.auth_service import decode_access_token, get_me_from_payload
from ..services.diagnostics_service import get_extended_health_payload
from ..services.task_service import (
    build_output_path,
    bulk_delete_task_payload,
    create_delta_t_null_task,
    create_mrnmr_steady_task,
    create_pcmci_causal_task,
    create_simulation_task,
    create_word_analysis_task,
    delete_task_payload,
    get_task_payload,
    list_task_payload,
    retry_task_payload,
)
from ..services.artifact_service import list_task_artifacts_payload
from ..services.task_event_service import list_task_events_payload
from ..services.turnstile_service import is_turnstile_configured, verify_turnstile_token
from ..tasks import deltat_null, demo_analysis, mrnmr_steady, pcmci_causal, simulation_run

router = APIRouter()


class BulkDeleteTasksBody(BaseModel):
    task_ids: list[str]


def _enforce_turnstile(
    request: Request,
    turnstile_token: str | None,
    task_type: str,
    owner_user_id: int | None = None,
):
    if not is_turnstile_configured():
        return
    client_ip = request.client.host if request.client else None
    ok, errors = verify_turnstile_token(turnstile_token or "", remote_ip=client_ip)
    if ok:
        return
    insert_audit_log(
        action="TASK_CREATE_BLOCKED",
        actor_user_id=owner_user_id,
        target_type="task",
        meta={"task_type": task_type, "reason": "turnstile_invalid", "turnstile_errors": errors},
    )
    raise HTTPException(status_code=400, detail="Turnstile verification failed")


@router.get("/health")
def health():
    return {"status": "ok", "db": check_db()}


@router.get("/api/health/extended")
def health_extended():
    return get_extended_health_payload()


@router.post("/api/tasks/word-analysis")
def create_task(
    request: Request,
    word: str,
    start_year: int = 1900,
    end_year: int = 2019,
    smoothing: int = 3,
    corpus: str = "eng_2019",
    variants: str | None = None,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token"),
):
    owner_user_id = int(current_user["id"]) if current_user else None
    _enforce_turnstile(request, turnstile_token, task_type="word-analysis", owner_user_id=owner_user_id)
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    result = create_word_analysis_task(
        word,
        demo_analysis,
        owner_user_id=owner_user_id,
        guest_key=guest_key,
        extra_params={
            "start_year": int(start_year),
            "end_year": int(end_year),
            "smoothing": int(smoothing),
            "corpus": corpus,
            "variants": selected_variants,
        },
    )
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={
            "task_type": "word-analysis",
            "word": word,
            "start_year": start_year,
            "end_year": end_year,
            "smoothing": smoothing,
            "corpus": corpus,
            "variants_count": len(selected_variants),
        },
    )
    return result


@router.get("/api/tasks/{task_id}")
def get_task(task_id: str, current_user=Depends(get_optional_user), guest_key: str | None = Header(default=None, alias="X-Guest-Key")):
    return get_task_payload(task_id, demo_analysis.AsyncResult, current_user=current_user, guest_key=guest_key)


@router.get("/api/tasks/{task_id}/events")
def get_task_events(
    task_id: str,
    limit: int = 200,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    task_payload = get_task_payload(task_id, None, current_user=current_user, guest_key=guest_key)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"task_id": task_id, "items": []}
    return list_task_events_payload(task_id, limit)


@router.get("/api/tasks/{task_id}/artifacts")
def get_task_artifacts(task_id: str, current_user=Depends(get_optional_user), guest_key: str | None = Header(default=None, alias="X-Guest-Key")):
    task_payload = get_task_payload(task_id, None, current_user=current_user, guest_key=guest_key)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"task_id": task_id, "items": []}
    return list_task_artifacts_payload(task_id)


@router.get("/api/tasks")
def list_tasks(
    limit: int = 20,
    scope: str | None = None,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    return list_task_payload(limit, current_user=current_user, scope=scope, guest_key=guest_key)


@router.post("/api/tasks/bulk-delete")
def bulk_delete_tasks(
    body: BulkDeleteTasksBody,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    safe_ids = [str(task_id).strip() for task_id in (body.task_ids or []) if str(task_id).strip()]
    result = bulk_delete_task_payload(safe_ids, current_user=current_user, guest_key=guest_key)
    insert_audit_log(
        action="TASK_BULK_DELETE",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="task",
        meta={"requested": len(safe_ids), "deleted": result.get("deleted"), "skipped": result.get("skipped")},
    )
    return result


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, current_user=Depends(get_optional_user), guest_key: str | None = Header(default=None, alias="X-Guest-Key")):
    result = delete_task_payload(task_id, current_user=current_user, guest_key=guest_key)
    insert_audit_log(
        action="TASK_DELETE",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="task",
        target_id=task_id,
        meta={"deleted": bool(result.get("deleted")), "reason": result.get("reason")},
    )
    return result


@router.post("/api/tasks/simulation-run")
def create_sim_task(
    request: Request,
    n: int = 30,
    steps: int = 50,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token"),
):
    owner_user_id = int(current_user["id"]) if current_user else None
    _enforce_turnstile(request, turnstile_token, task_type="simulation-run", owner_user_id=owner_user_id)
    result = create_simulation_task(n, steps, simulation_run, owner_user_id=owner_user_id, guest_key=guest_key)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "simulation-run", "n": n, "steps": steps},
    )
    return result


@router.post("/api/tasks/pcmci-causal")
def create_pcmci_task(
    request: Request,
    word: str,
    start_year: int = 1900,
    end_year: int = 2019,
    smoothing: int = 3,
    corpus: str = "eng_2019",
    variants: str | None = None,
    tau_max: int = 8,
    window_size: int = 0,
    window_step: int = 0,
    alpha_level: float = 0.01,
    pc_alpha: float | None = None,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token"),
):
    owner_user_id = int(current_user["id"]) if current_user else None
    _enforce_turnstile(request, turnstile_token, task_type="pcmci-causal", owner_user_id=owner_user_id)
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    params = {
        "word": word,
        "start_year": int(start_year),
        "end_year": int(end_year),
        "smoothing": int(smoothing),
        "corpus": corpus,
        "variants": selected_variants,
        "tau_max": int(tau_max),
        "window_size": int(window_size),
        "window_step": int(window_step),
        "alpha_level": float(alpha_level),
        "pc_alpha": pc_alpha,
    }
    result = create_pcmci_causal_task(params, pcmci_causal, owner_user_id=owner_user_id, guest_key=guest_key)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "pcmci-causal", "word": word, "start_year": start_year, "end_year": end_year},
    )
    return result


@router.post("/api/tasks/mrnmr-steady")
def create_mrnmr_task(
    request: Request,
    word: str,
    start_year: int = 1900,
    end_year: int = 2019,
    smoothing: int = 3,
    corpus: str = "eng_2019",
    variants: str | None = None,
    origin_year: int | None = None,
    tipping_index: int = 0,
    kde_bandwidth: str = "scott",
    poly_degree: int = 20,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token"),
):
    owner_user_id = int(current_user["id"]) if current_user else None
    _enforce_turnstile(request, turnstile_token, task_type="mrnmr-steady", owner_user_id=owner_user_id)
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    params = {
        "word": word,
        "start_year": int(start_year),
        "end_year": int(end_year),
        "smoothing": int(smoothing),
        "corpus": corpus,
        "variants": selected_variants,
        "origin_year": int(origin_year) if origin_year not in (None, "") else None,
        "tipping_index": int(tipping_index),
        "kde_bandwidth": kde_bandwidth,
        "poly_degree": int(poly_degree),
    }
    result = create_mrnmr_steady_task(params, mrnmr_steady, owner_user_id=owner_user_id, guest_key=guest_key)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "mrnmr-steady", "word": word, "start_year": start_year, "end_year": end_year},
    )
    return result


@router.post("/api/tasks/deltaT-null")
def create_delta_t_task(
    request: Request,
    word: str,
    start_year: int = 1900,
    end_year: int = 2019,
    smoothing: int = 3,
    corpus: str = "eng_2019",
    variants: str | None = None,
    origin_year: int | None = None,
    bootstrap_samples: int = 500,
    event_threshold_quantile: float = 0.9,
    random_seed: int = 42,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token"),
):
    owner_user_id = int(current_user["id"]) if current_user else None
    _enforce_turnstile(request, turnstile_token, task_type="deltaT-null", owner_user_id=owner_user_id)
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    params = {
        "word": word,
        "start_year": int(start_year),
        "end_year": int(end_year),
        "smoothing": int(smoothing),
        "corpus": corpus,
        "variants": selected_variants,
        "origin_year": int(origin_year) if origin_year not in (None, "") else None,
        "bootstrap_samples": int(bootstrap_samples),
        "event_threshold_quantile": float(event_threshold_quantile),
        "random_seed": int(random_seed),
    }
    result = create_delta_t_null_task(params, deltat_null, owner_user_id=owner_user_id, guest_key=guest_key)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "deltaT-null", "word": word, "start_year": start_year, "end_year": end_year},
    )
    return result


@router.post("/api/tasks/{task_id}/retry")
def retry_task(task_id: str, current_user=Depends(get_optional_user), guest_key: str | None = Header(default=None, alias="X-Guest-Key")):
    payload = retry_task_payload(
        task_id,
        {
            "word-analysis": demo_analysis,
            "simulation-run": simulation_run,
            "pcmci-causal": pcmci_causal,
            "mrnmr-steady": mrnmr_steady,
            "deltaT-null": deltat_null,
        },
        current_user=current_user,
        guest_key=guest_key,
    )
    insert_audit_log(
        action="TASK_RETRY",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="task",
        target_id=task_id,
        meta=payload,
    )
    return payload


@router.get("/api/files/{task_id}/{filename}")
def download_file(
    task_id: str,
    filename: str,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    access_token: str | None = Query(default=None),
    guest_key_query: str | None = Query(default=None, alias="guest_key"),
):
    effective_user = current_user
    if effective_user is None and access_token:
        payload = decode_access_token(access_token.strip())
        if payload:
            effective_user = get_me_from_payload(payload)
    effective_guest_key = (guest_key or guest_key_query or "").strip() or None
    task_payload = get_task_payload(task_id, None, current_user=effective_user, guest_key=effective_guest_key)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"error": "file not found"}
    p = build_output_path(task_id, filename)
    if not p.exists():
        return {"error": "file not found"}
    return FileResponse(str(p), filename=filename)
