import json
import os
import time
from typing import Any

import redis

from ..celery_app import celery_app
from ..db.audit_logs_repo import list_recent_audit_logs
from ..db.core import check_db, get_engine
from ..providers.llm_bailian import llm_config_fingerprint


def _now_ms() -> int:
    return int(time.time() * 1000)


def _db_probe() -> dict[str, Any]:
    started = _now_ms()
    ok = False
    error = None
    try:
        ok = check_db()
    except Exception as exc:
        error = str(exc)
    latency = _now_ms() - started
    return {"ok": ok, "latency_ms": latency, "last_error": error}


def _redis_probe() -> dict[str, Any]:
    started = _now_ms()
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    error = None
    ok = False
    try:
        client = redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)
        ok = bool(client.ping())
    except Exception as exc:
        error = str(exc)
    latency = _now_ms() - started
    return {
        "ok": ok,
        "latency_ms": latency,
        "last_error": error,
        "config": {
            "url": redis_url,
        },
    }


def _worker_probe() -> dict[str, Any]:
    started = _now_ms()
    error = None
    ok = False
    workers = 0
    try:
        ping = celery_app.control.inspect(timeout=1).ping() or {}
        workers = len(ping)
        ok = workers > 0
        if not ok:
            error = "no_worker_reply"
    except Exception as exc:
        error = str(exc)
    latency = _now_ms() - started
    return {
        "ok": ok,
        "latency_ms": latency,
        "workers": workers,
        "last_error": error,
    }


def _env_bool(name: str) -> bool:
    return bool((os.getenv(name) or "").strip())


def _llm_probe() -> dict[str, Any]:
    fingerprint = llm_config_fingerprint()
    key_present = bool(fingerprint["key_present"])
    return {
        "ok": key_present,
        "latency_ms": None,
        "last_error": None if key_present else "key_missing",
        "config_fingerprint": fingerprint,
    }


def _gbnc_probe() -> dict[str, Any]:
    timeout = int(os.getenv("GBNC_TIMEOUT_SECONDS", "10") or "10")
    retries = int(os.getenv("GBNC_RETRIES", "1") or "1")
    ua = (os.getenv("GBNC_USER_AGENT") or "misspelling-platform/1.0").strip()
    return {
        "ok": True,
        "latency_ms": None,
        "last_error": None,
        "config_fingerprint": {
            "provider": "google-ngram-viewer",
            "timeout_seconds": timeout,
            "retries": retries,
            "user_agent_set": bool(ua),
            "proxy_configured": _env_bool("HTTPS_PROXY") or _env_bool("HTTP_PROXY"),
        },
    }


def _recent_logs(limit: int = 20):
    rows = list_recent_audit_logs(limit)
    result = []
    for row in rows:
        meta = row.get("meta_json")
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                pass
        result.append(
            {
                "id": int(row["id"]),
                "action": row["action"],
                "target_type": row.get("target_type"),
                "target_id": row.get("target_id"),
                "created_at": row.get("created_at"),
                "meta": meta,
            }
        )
    return result


def _last_data_pull():
    rows = list_recent_audit_logs(10, action_prefix="DATA_PULL")
    if not rows:
        return None
    row = rows[0]
    meta = row.get("meta_json")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            pass
    return {
        "action": row["action"],
        "target_type": row.get("target_type"),
        "target_id": row.get("target_id"),
        "created_at": row.get("created_at"),
        "meta": meta,
    }


def get_extended_health_payload() -> dict[str, Any]:
    db_state = _db_probe()
    redis_state = _redis_probe()
    worker_state = _worker_probe()
    llm_state = _llm_probe()
    gbnc_state = _gbnc_probe()

    warnings: list[str] = []
    if not db_state["ok"]:
        warnings.append("db_unreachable")
    if not redis_state["ok"]:
        warnings.append("redis_unreachable")
    if not worker_state["ok"]:
        warnings.append("worker_unreachable")
    if not llm_state["ok"]:
        warnings.append("llm_disabled")

    return {
        "status": "ok" if db_state["ok"] else "degraded",
        "db": db_state["ok"],
        "redis": redis_state["ok"],
        "worker": worker_state["ok"],
        "llm_enabled": llm_state["ok"],
        "gbnc_enabled": gbnc_state["ok"],
        "warnings": warnings,
        "components": {
            "db": db_state,
            "redis": redis_state,
            "worker": worker_state,
            "llm": llm_state,
            "gbnc": gbnc_state,
        },
    }


def get_admin_diagnostics_payload() -> dict[str, Any]:
    health = get_extended_health_payload()
    recent_logs = _recent_logs(30)
    return {
        **health,
        "config_fingerprint": {
            "database_url_present": bool((os.getenv("DATABASE_URL") or "").strip()),
            "redis_url_present": bool((os.getenv("REDIS_URL") or "").strip()),
            "llm": health["components"]["llm"]["config_fingerprint"],
            "gbnc": health["components"]["gbnc"]["config_fingerprint"],
        },
        "last_data_pull": _last_data_pull(),
        "recent_audit_logs": recent_logs,
    }
