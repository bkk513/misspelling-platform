import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

from sqlalchemy import bindparam, text

from ..db.core import get_engine
from .task_event_service import record_task_failure, record_task_queued

OUTPUT_ROOT = Path("/app/outputs")


def build_output_path(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_guest_key(guest_key: str | None) -> str:
    return str(guest_key or "").strip()[:64]


def _is_today_utc(value: Any) -> bool:
    today = datetime.now(timezone.utc).date()
    if value is None:
        return False
    if hasattr(value, "date"):
        try:
            return value.date() == today
        except Exception:
            pass
    text_value = str(value)
    if len(text_value) >= 10:
        try:
            return datetime.strptime(text_value[:10], "%Y-%m-%d").date() == today
        except Exception:
            return False
    return False


def _can_access_row(
    owner_user_id: int | None,
    row_guest_key: str | None,
    created_at: Any,
    current_user: dict | None,
    guest_key: str | None,
) -> bool:
    if _is_admin(current_user):
        return True
    user_id = _owner_id(current_user)
    if user_id is not None:
        return owner_user_id == user_id
    if owner_user_id is not None:
        return False
    request_guest_key = _normalize_guest_key(guest_key)
    if not request_guest_key:
        return False
    if _normalize_guest_key(row_guest_key) != request_guest_key:
        return False
    return _is_today_utc(created_at)


def _scope_clause(current_user: dict | None, scope: str | None, guest_key: str | None) -> tuple[str, dict[str, Any]]:
    if _is_admin(current_user):
        if scope == "all":
            return "1=1", {}
        if scope == "guest":
            return "owner_user_id IS NULL", {}
        if scope and scope.startswith("user:"):
            try:
                user_id = int(scope.split(":", 1)[1])
            except Exception:
                user_id = _owner_id(current_user)
            return "owner_user_id = :owner_user_id", {"owner_user_id": user_id}
        return "1=1", {}

    user_id = _owner_id(current_user)
    if user_id is not None:
        return "owner_user_id = :owner_user_id", {"owner_user_id": user_id}

    safe_guest_key = _normalize_guest_key(guest_key)
    if not safe_guest_key:
        return "1=0", {}
    return "owner_user_id IS NULL AND guest_key=:guest_key AND created_at >= UTC_DATE()", {"guest_key": safe_guest_key}


def _cleanup_old_guest_tasks() -> None:
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT task_id
                    FROM tasks
                    WHERE owner_user_id IS NULL
                      AND created_at < UTC_DATE()
                      AND status <> 'DELETED'
                    ORDER BY id ASC
                    LIMIT 5000
                    """
                )
            )
            .mappings()
            .all()
        )
        task_ids = [str(r["task_id"]) for r in rows]
        if not task_ids:
            return

        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='DELETED',
                    deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP),
                    updated_at=CURRENT_TIMESTAMP
                WHERE task_id IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM task_events WHERE task_id IN :task_ids").bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM task_artifacts WHERE task_id IN :task_ids").bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM report_exports WHERE owner_user_id IS NULL AND task_id IN :task_ids").bindparams(
                bindparam("task_ids", expanding=True)
            ),
            {"task_ids": task_ids},
        )
        conn.execute(
            text(
                """
                DELETE p FROM time_series_points p
                JOIN time_series s ON s.id = p.series_id
                WHERE JSON_UNQUOTE(JSON_EXTRACT(s.meta_json, '$.task_id')) IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text(
                """
                DELETE FROM time_series
                WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')) IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )


def _insert_queued_task(
    task_id: str,
    task_type: str,
    params: dict[str, Any],
    owner_user_id: int | None,
    guest_key: str | None,
) -> None:
    safe_guest_key = _normalize_guest_key(guest_key) if owner_user_id is None else None
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO tasks (task_id, task_type, status, params_json, owner_user_id, guest_key)
                VALUES (:task_id, :task_type, :status, :params_json, :owner_user_id, :guest_key)
                ON DUPLICATE KEY UPDATE
                  status=VALUES(status),
                  params_json=VALUES(params_json),
                  owner_user_id=VALUES(owner_user_id),
                  guest_key=VALUES(guest_key),
                  updated_at=CURRENT_TIMESTAMP
                """
            ),
            {
                "task_id": task_id,
                "task_type": task_type,
                "status": "QUEUED",
                "params_json": json.dumps(params),
                "owner_user_id": owner_user_id,
                "guest_key": safe_guest_key,
            },
        )


def _mark_task_enqueue_failure(task_id: str, task_type: str, error_text: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='FAILURE', error_text=:error_text
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id, "error_text": error_text},
        )
    record_task_failure(task_id, task_type, error_text)


def create_word_analysis_task(
    word: str,
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
    extra_params: dict[str, Any] | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    params = {"word": word}
    if extra_params:
        params.update(extra_params)
    _insert_queued_task(task_id, "word-analysis", params, owner_user_id, guest_key)
    record_task_queued(task_id, "word-analysis", params)
    try:
        celery_task.apply_async(args=[params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "word-analysis", str(exc))
        raise
    return {"task_id": task_id}


def create_simulation_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "simulation-run", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "simulation-run", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "simulation-run", str(exc))
        raise
    return {"task_id": task_id}


def create_pcmci_causal_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "pcmci-causal", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "pcmci-causal", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "pcmci-causal", str(exc))
        raise
    return {"task_id": task_id}


def create_mrnmr_steady_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "mrnmr-steady", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "mrnmr-steady", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "mrnmr-steady", str(exc))
        raise
    return {"task_id": task_id}


def create_delta_t_null_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "deltaT-null", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "deltaT-null", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "deltaT-null", str(exc))
        raise
    return {"task_id": task_id}


def retry_task_payload(
    task_id: str,
    celery_task_map: dict[str, Any],
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, task_type, status, params_json, owner_user_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return {"ok": False, "reason": "NOT_FOUND", "task_id": task_id}
    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"ok": False, "reason": "FORBIDDEN", "task_id": task_id}

    status = str(row["status"] or "").upper()
    if status in ("QUEUED", "RUNNING", "PROGRESS"):
        return {"ok": False, "reason": "TASK_ACTIVE", "task_id": task_id}

    task_type = str(row["task_type"])
    params = _normalize_jsonish(row["params_json"])
    if not isinstance(params, dict):
        return {"ok": False, "reason": "PARAMS_INVALID", "task_id": task_id}

    if task_type == "word-analysis":
        task = celery_task_map.get("word-analysis")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        extra = {k: v for k, v in params.items() if k != "word"}
        created = create_word_analysis_task(
            str(params.get("word", "demo")),
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
            extra_params=extra,
        )
    elif task_type == "simulation-run":
        task = celery_task_map.get("simulation-run")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_simulation_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "pcmci-causal":
        task = celery_task_map.get("pcmci-causal")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_pcmci_causal_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "mrnmr-steady":
        task = celery_task_map.get("mrnmr-steady")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_mrnmr_steady_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "deltaT-null":
        task = celery_task_map.get("deltaT-null")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_delta_t_null_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    else:
        return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}

    new_task_id = str(created["task_id"])
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE tasks SET parent_task_id=:parent_task_id WHERE task_id=:task_id"),
            {"task_id": new_task_id, "parent_task_id": task_id},
        )
    return {"ok": True, "task_id": new_task_id, "parent_task_id": task_id, "task_type": task_type}


def _normalize_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except Exception:
            return str(value)
    if isinstance(value, str):
        text_value = value.strip()
        for _ in range(2):
            if not isinstance(text_value, str):
                break
            if not (text_value.startswith("{") or text_value.startswith("[")):
                break
            try:
                decoded = json.loads(text_value)
            except Exception:
                break
            if isinstance(decoded, str):
                text_value = decoded
                continue
            return decoded
        return text_value
    return str(value)


def _task_display_name(task_type: str, params: Any) -> str:
    if task_type == "word-analysis" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"word-analysis: {word}"
    if task_type == "simulation-run" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        topology = str(params.get("topology", "")).strip() or "topology"
        return f"simulation-run: {word} ({topology})"
    if task_type == "pcmci-causal" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"pcmci-causal: {word}"
    if task_type == "mrnmr-steady" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"mrnmr-steady: {word}"
    if task_type == "deltaT-null" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"deltaT-null: {word}"
    return task_type


def get_task_owner(task_id: str) -> int | None:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text("SELECT owner_user_id FROM tasks WHERE task_id=:task_id LIMIT 1"),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return row["owner_user_id"]


def get_task_guest_key(task_id: str) -> str | None:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text("SELECT guest_key FROM tasks WHERE task_id=:task_id LIMIT 1"),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return row.get("guest_key")


def get_task_payload(
    task_id: str,
    async_result_factory=None,
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, status, params_json, result_json, error_text, owner_user_id,
                           parent_task_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )

    if not row:
        if async_result_factory is None:
            return {"task_id": task_id, "state": "NOT_FOUND"}
        res = async_result_factory(task_id)
        payload = {"task_id": task_id, "state": res.state}
        if res.successful():
            payload["result"] = _normalize_jsonish(res.result)
        return payload

    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"task_id": task_id, "state": "NOT_FOUND"}

    payload: Dict[str, Any] = {
        "task_id": row["task_id"],
        "state": row["status"],
        "params": _normalize_jsonish(row["params_json"]),
        "result": _normalize_jsonish(row["result_json"]),
        "error": _normalize_jsonish(row["error_text"]),
        "parent_task_id": row.get("parent_task_id"),
    }
    if async_result_factory is not None and row["status"] in ("QUEUED", "RUNNING"):
        res = async_result_factory(task_id)
        try:
            if res.info is not None:
                payload["progress"] = _normalize_jsonish(res.info)
        except Exception:
            pass
    return payload


def list_task_payload(
    limit: int = 20,
    current_user: dict | None = None,
    scope: str | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 200))
    if _owner_id(current_user) is None:
        _cleanup_old_guest_tasks()
    scope_where, scope_params = _scope_clause(current_user, scope, guest_key)
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    f"""
                    SELECT task_id, task_type, status, params_json, created_at, updated_at, owner_user_id,
                           parent_task_id, guest_key
                    FROM tasks
                    WHERE status <> 'DELETED' AND ({scope_where})
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit, **scope_params},
            )
            .mappings()
            .all()
        )
    return {
        "items": [
            {
                "task_id": r["task_id"],
                "task_type": r["task_type"],
                "status": r["status"],
                "display_name": _task_display_name(r["task_type"], _normalize_jsonish(r["params_json"])),
                "params_json": _normalize_jsonish(r["params_json"]),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "owner_user_id": r.get("owner_user_id"),
                "parent_task_id": r.get("parent_task_id"),
            }
            for r in rows
        ]
    }


def _delete_task_with_relations(task_id: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='DELETED', deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id},
        )
        conn.execute(text("DELETE FROM task_events WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(text("DELETE FROM task_artifacts WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(text("DELETE FROM report_exports WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(
            text(
                """
                DELETE p FROM time_series_points p
                JOIN time_series s ON s.id = p.series_id
                WHERE JSON_UNQUOTE(JSON_EXTRACT(s.meta_json, '$.task_id')) = :task_id
                """
            ),
            {"task_id": task_id},
        )
        conn.execute(
            text("DELETE FROM time_series WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')) = :task_id"),
            {"task_id": task_id},
        )


def delete_task_payload(task_id: str, current_user: dict | None = None, guest_key: str | None = None) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, status, owner_user_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return {"task_id": task_id, "deleted": False, "reason": "NOT_FOUND"}
    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"task_id": task_id, "deleted": False, "reason": "FORBIDDEN"}
    if str(row["status"]).upper() in ("RUNNING", "QUEUED", "PROGRESS"):
        return {"task_id": task_id, "deleted": False, "reason": "TASK_ACTIVE"}

    _delete_task_with_relations(task_id)
    return {"task_id": task_id, "deleted": True}


def bulk_delete_task_payload(
    task_ids: list[str],
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    deleted: list[str] = []
    skipped: list[dict[str, str]] = []
    for task_id in task_ids:
        item = delete_task_payload(task_id, current_user, guest_key)
        if item.get("deleted"):
            deleted.append(task_id)
        else:
            skipped.append({"task_id": task_id, "reason": str(item.get("reason") or "UNKNOWN")})
    return {"deleted": deleted, "skipped": skipped, "requested": len(task_ids)}
