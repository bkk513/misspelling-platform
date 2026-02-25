from fastapi import APIRouter
from fastapi.responses import FileResponse

from ..db.core import check_db
from ..services.task_service import (
    build_output_path,
    create_simulation_task,
    create_word_analysis_task,
    get_task_payload,
    list_task_payload,
)
from ..services.task_event_service import list_task_events_payload
from ..tasks import demo_analysis, simulation_run

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "db": check_db()}


@router.post("/api/tasks/word-analysis")
def create_task(word: str):
    return create_word_analysis_task(word, demo_analysis)


@router.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    return get_task_payload(task_id, demo_analysis.AsyncResult)


@router.get("/api/tasks/{task_id}/events")
def get_task_events(task_id: str, limit: int = 200):
    return list_task_events_payload(task_id, limit)


@router.get("/api/tasks")
def list_tasks(limit: int = 20):
    return list_task_payload(limit)


@router.post("/api/tasks/simulation-run")
def create_sim_task(n: int = 30, steps: int = 50):
    return create_simulation_task(n, steps, simulation_run)


@router.get("/api/files/{task_id}/{filename}")
def download_file(task_id: str, filename: str):
    p = build_output_path(task_id, filename)
    if not p.exists():
        return {"error": "file not found"}
    return FileResponse(str(p), filename=filename)
