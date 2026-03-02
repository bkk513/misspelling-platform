import os

import redis
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .auth_deps import get_optional_user
from ..db.core import check_db
from ..services.task_service import (
    build_output_path,
    bulk_delete_task_payload,
    create_simulation_task,
    create_word_analysis_task,
    delete_task_payload,
    get_task_payload,
    list_task_payload,
)
from ..services.artifact_service import list_task_artifacts_payload
from ..services.task_event_service import list_task_events_payload
from ..tasks import demo_analysis, simulation_run

router = APIRouter()


class BulkDeleteTasksBody(BaseModel):
    task_ids: list[str]


@router.get("/health")
def health():
    return {"status": "ok", "db": check_db()}


@router.get("/api/health/extended")
def health_extended():
    warnings: list[str] = []
    db_ok = check_db()
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    redis_ok = False
    try:
        client = redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)
        redis_ok = bool(client.ping())
    except Exception:
        warnings.append("redis_unreachable")

    llm_enabled = bool((os.getenv("DASHSCOPE_API_KEY") or os.getenv("BAILIAN_API_KEY") or "").strip())
    if not llm_enabled:
        warnings.append("llm_key_missing")
    gbnc_enabled = True
    return {
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
        "redis": redis_ok,
        "llm_enabled": llm_enabled,
        "gbnc_enabled": gbnc_enabled,
        "warnings": warnings,
    }


@router.post("/api/tasks/word-analysis")
def create_task(word: str, current_user=Depends(get_optional_user)):
    owner_user_id = int(current_user["id"]) if current_user else None
    return create_word_analysis_task(word, demo_analysis, owner_user_id=owner_user_id)


@router.get("/api/tasks/{task_id}")
def get_task(task_id: str, current_user=Depends(get_optional_user)):
    return get_task_payload(task_id, demo_analysis.AsyncResult, current_user=current_user)


@router.get("/api/tasks/{task_id}/events")
def get_task_events(task_id: str, limit: int = 200, current_user=Depends(get_optional_user)):
    task_payload = get_task_payload(task_id, None, current_user=current_user)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"task_id": task_id, "items": []}
    return list_task_events_payload(task_id, limit)


@router.get("/api/tasks/{task_id}/artifacts")
def get_task_artifacts(task_id: str, current_user=Depends(get_optional_user)):
    task_payload = get_task_payload(task_id, None, current_user=current_user)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"task_id": task_id, "items": []}
    return list_task_artifacts_payload(task_id)


@router.get("/api/tasks")
def list_tasks(limit: int = 20, scope: str | None = None, current_user=Depends(get_optional_user)):
    return list_task_payload(limit, current_user=current_user, scope=scope)


@router.post("/api/tasks/bulk-delete")
def bulk_delete_tasks(body: BulkDeleteTasksBody, current_user=Depends(get_optional_user)):
    safe_ids = [str(task_id).strip() for task_id in (body.task_ids or []) if str(task_id).strip()]
    return bulk_delete_task_payload(safe_ids, current_user=current_user)


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, current_user=Depends(get_optional_user)):
    return delete_task_payload(task_id, current_user=current_user)


@router.post("/api/tasks/simulation-run")
def create_sim_task(n: int = 30, steps: int = 50, current_user=Depends(get_optional_user)):
    owner_user_id = int(current_user["id"]) if current_user else None
    return create_simulation_task(n, steps, simulation_run, owner_user_id=owner_user_id)


@router.get("/api/files/{task_id}/{filename}")
def download_file(task_id: str, filename: str, current_user=Depends(get_optional_user)):
    task_payload = get_task_payload(task_id, None, current_user=current_user)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"error": "file not found"}
    p = build_output_path(task_id, filename)
    if not p.exists():
        return {"error": "file not found"}
    return FileResponse(str(p), filename=filename)
