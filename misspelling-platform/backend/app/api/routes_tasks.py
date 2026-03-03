from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .auth_deps import get_optional_user
from ..db.core import check_db
from ..db.audit_logs_repo import insert_audit_log
from ..services.diagnostics_service import get_extended_health_payload
from ..services.task_service import (
    build_output_path,
    bulk_delete_task_payload,
    create_simulation_task,
    create_word_analysis_task,
    delete_task_payload,
    get_task_payload,
    list_task_payload,
    retry_task_payload,
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
    return get_extended_health_payload()


@router.post("/api/tasks/word-analysis")
def create_task(word: str, current_user=Depends(get_optional_user)):
    owner_user_id = int(current_user["id"]) if current_user else None
    result = create_word_analysis_task(word, demo_analysis, owner_user_id=owner_user_id)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "word-analysis", "word": word},
    )
    return result


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
    result = bulk_delete_task_payload(safe_ids, current_user=current_user)
    insert_audit_log(
        action="TASK_BULK_DELETE",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="task",
        meta={"requested": len(safe_ids), "deleted": result.get("deleted"), "skipped": result.get("skipped")},
    )
    return result


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, current_user=Depends(get_optional_user)):
    result = delete_task_payload(task_id, current_user=current_user)
    insert_audit_log(
        action="TASK_DELETE",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="task",
        target_id=task_id,
        meta={"deleted": bool(result.get("deleted")), "reason": result.get("reason")},
    )
    return result


@router.post("/api/tasks/simulation-run")
def create_sim_task(n: int = 30, steps: int = 50, current_user=Depends(get_optional_user)):
    owner_user_id = int(current_user["id"]) if current_user else None
    result = create_simulation_task(n, steps, simulation_run, owner_user_id=owner_user_id)
    insert_audit_log(
        action="TASK_CREATE",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=result["task_id"],
        meta={"task_type": "simulation-run", "n": n, "steps": steps},
    )
    return result


@router.post("/api/tasks/{task_id}/retry")
def retry_task(task_id: str, current_user=Depends(get_optional_user)):
    payload = retry_task_payload(
        task_id,
        {
            "word-analysis": demo_analysis,
            "simulation-run": simulation_run,
        },
        current_user=current_user,
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
def download_file(task_id: str, filename: str, current_user=Depends(get_optional_user)):
    task_payload = get_task_payload(task_id, None, current_user=current_user)
    if str(task_payload.get("state", "")).upper() == "NOT_FOUND":
        return {"error": "file not found"}
    p = build_output_path(task_id, filename)
    if not p.exists():
        return {"error": "file not found"}
    return FileResponse(str(p), filename=filename)
