import json
from pathlib import Path

from ..db.tasks_repo import get_task, insert_task, list_tasks

OUTPUT_ROOT = Path("/app/outputs")


def create_word_analysis_task(word: str, task_func):
    job = task_func.delay(word)
    insert_task(job.id, "word-analysis", "QUEUED", json.dumps({"word": word}))
    return {"task_id": job.id}


def create_simulation_task(n: int, steps: int, task_func):
    job = task_func.delay(n, steps)
    insert_task(job.id, "simulation-run", "QUEUED", json.dumps({"n": n, "steps": steps}))
    return {"task_id": job.id}


def get_task_payload(task_id: str, async_result_factory):
    row = get_task(task_id)
    if row:
        payload = {
            "task_id": row["task_id"],
            "state": row["status"],
            "params": row["params_json"],
            "result": row["result_json"],
            "error": row["error_text"],
        }
        if row["status"] in ("QUEUED", "RUNNING"):
            res = async_result_factory(task_id)
            try:
                if res.info is not None:
                    payload["progress"] = (
                        res.info
                        if isinstance(res.info, (dict, list, str, int, float, bool))
                        else str(res.info)
                    )
            except Exception:
                pass
        return payload

    res = async_result_factory(task_id)
    payload = {"task_id": task_id, "state": res.state}
    if res.successful():
        payload["result"] = res.result
    return payload


def list_task_payload(limit: int):
    limit = max(1, min(limit, 200))
    return {"items": list(list_tasks(limit))}


def build_output_path(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename
