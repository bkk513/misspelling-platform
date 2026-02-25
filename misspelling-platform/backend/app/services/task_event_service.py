import json
from typing import Any

from ..db.task_events_repo import insert_event, list_events


def record_task_event(
    task_id: str,
    event_type: str,
    message: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    meta_json = json.dumps(meta) if meta is not None else None
    insert_event(task_id, event_type, message or event_type, meta_json)


def record_task_queued(task_id: str, task_type: str, params: dict[str, Any]) -> None:
    record_task_event(task_id, "QUEUED", f"{task_type} queued", {"task_type": task_type, "params": params})


def record_task_running(task_id: str, task_type: str) -> None:
    record_task_event(task_id, "RUNNING", f"{task_type} running", {"task_type": task_type})


def record_task_success(task_id: str, task_type: str) -> None:
    record_task_event(task_id, "SUCCESS", f"{task_type} success", {"task_type": task_type})


def record_task_failure(task_id: str, task_type: str, error_text: str) -> None:
    record_task_event(
        task_id,
        "FAILURE",
        f"{task_type} failure",
        {"task_type": task_type, "error": error_text},
    )


def _normalize_jsonish(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except Exception:
            return str(value)
    if isinstance(value, str):
        text_value = value.strip()
        if text_value.startswith("{") or text_value.startswith("["):
            try:
                return json.loads(text_value)
            except Exception:
                return value
    return value


def list_task_events_payload(task_id: str, limit: int = 200) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit), 500))
    rows = list_events(task_id, safe_limit)
    return {
        "task_id": task_id,
        "items": [
            {
                "task_id": row["task_id"],
                "event_type": row["level"],
                "message": row["message"],
                "meta": _normalize_jsonish(row["meta_json"]),
                "created_at": row["ts"],
            }
            for row in rows
        ],
    }
