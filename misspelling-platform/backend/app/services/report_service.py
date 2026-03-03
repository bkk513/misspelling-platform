import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..db.audit_logs_repo import insert_audit_log
from ..db.report_exports_repo import create_report_export, get_report_export, list_report_exports
from .artifact_service import build_output_dir, register_artifact
from .project_service import list_project_tasks_payload, list_project_terms_payload
from .task_event_service import list_task_events_payload
from .task_service import get_task_payload
from .timeseries_service import get_task_timeseries_summary


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize(value: Any):
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
        if text_value.startswith("{") or text_value.startswith("["):
            try:
                return json.loads(text_value)
            except Exception:
                return value
    return value


def _write_html_report(task_id: str, filename: str, title: str, body_html: str) -> Path:
    out_dir = build_output_dir(task_id)
    path = out_dir / filename
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111; }}
    h1,h2 {{ margin: 0 0 12px; }}
    .muted {{ color: #555; }}
    pre {{ background: #f6f6f6; padding: 12px; border: 1px solid #ddd; overflow:auto; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 12px; }}
    th,td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <div class="muted">generated_at={datetime.now(timezone.utc).isoformat()}</div>
  {body_html}
</body>
</html>"""
    path.write_text(html, encoding="utf-8")
    return path


def create_task_report_payload(task_id: str, current_user: dict | None = None, project_id: int | None = None):
    task = get_task_payload(task_id, async_result_factory=None, current_user=current_user)
    if str(task.get("state", "")).upper() == "NOT_FOUND":
        raise HTTPException(status_code=404, detail="task not found")

    events = list_task_events_payload(task_id, limit=400).get("items") or []
    time_series = get_task_timeseries_summary(task_id, current_user=current_user)
    params = _normalize(task.get("params"))
    result = _normalize(task.get("result"))
    event_rows = "".join(
        f"<tr><td>{e.get('created_at') or ''}</td><td>{e.get('event_type') or ''}</td><td>{e.get('message') or ''}</td></tr>"
        for e in events
    )
    body = f"""
<h2>Summary</h2>
<p>task_id={task_id} state={task.get("state")} project_id={project_id or "-"}</p>
<h2>Parameters</h2>
<pre>{json.dumps(params, ensure_ascii=False, indent=2)}</pre>
<h2>Result</h2>
<pre>{json.dumps(result, ensure_ascii=False, indent=2)}</pre>
<h2>Time Series</h2>
<pre>{json.dumps(time_series, ensure_ascii=False, indent=2)}</pre>
<h2>Task Events</h2>
<table><thead><tr><th>time</th><th>event</th><th>message</th></tr></thead><tbody>{event_rows}</tbody></table>
"""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"report-{stamp}.html"
    path = _write_html_report(task_id=task_id, filename=filename, title=f"Task Report {task_id}", body_html=body)
    register_artifact(task_id=task_id, kind="html", filename=filename, path=path, content_type="text/html")

    owner_user_id = _owner_id(current_user)
    report_id = create_report_export(
        owner_user_id=owner_user_id,
        task_id=task_id,
        project_id=project_id,
        report_format="html",
        filename=filename,
        path=str(path),
        summary={"task_id": task_id, "project_id": project_id, "state": task.get("state")},
    )
    insert_audit_log(
        action="REPORT_EXPORT",
        actor_user_id=owner_user_id,
        target_type="task",
        target_id=task_id,
        meta={"report_id": report_id, "format": "html", "project_id": project_id},
    )
    return {
        "report_id": report_id,
        "task_id": task_id,
        "project_id": project_id,
        "status": "READY",
        "format": "html",
        "filename": filename,
        "download_url": f"/api/files/{task_id}/{filename}",
    }


def create_project_report_payload(project_id: int, current_user: dict | None = None):
    tasks_payload = list_project_tasks_payload(project_id=project_id, current_user=current_user, limit=300)
    terms_payload = list_project_terms_payload(project_id=project_id, current_user=current_user)
    tasks = tasks_payload.get("items") or []
    terms = terms_payload.get("items") or []
    if not tasks:
        raise HTTPException(status_code=400, detail="project has no tasks to anchor report artifacts")

    anchor_task_id = str(tasks[0]["task_id"])
    body = f"""
<h2>Project Summary</h2>
<p>project_id={project_id} tasks={len(tasks)} terms={len(terms)}</p>
<h2>Terms</h2>
<pre>{json.dumps(terms, ensure_ascii=False, indent=2)}</pre>
<h2>Tasks</h2>
<pre>{json.dumps(tasks, ensure_ascii=False, indent=2)}</pre>
"""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"project-{project_id}-report-{stamp}.html"
    path = _write_html_report(task_id=anchor_task_id, filename=filename, title=f"Project Report {project_id}", body_html=body)
    register_artifact(task_id=anchor_task_id, kind="html", filename=filename, path=path, content_type="text/html")

    owner_user_id = _owner_id(current_user)
    report_id = create_report_export(
        owner_user_id=owner_user_id,
        task_id=anchor_task_id,
        project_id=project_id,
        report_format="html",
        filename=filename,
        path=str(path),
        summary={"project_id": project_id, "tasks": len(tasks), "terms": len(terms)},
    )
    insert_audit_log(
        action="REPORT_EXPORT",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"report_id": report_id, "task_id": anchor_task_id, "format": "html"},
    )
    return {
        "report_id": report_id,
        "task_id": anchor_task_id,
        "project_id": project_id,
        "status": "READY",
        "format": "html",
        "filename": filename,
        "download_url": f"/api/files/{anchor_task_id}/{filename}",
    }


def list_reports_payload(limit: int = 100, scope: str | None = None, current_user: dict | None = None):
    include_all = _is_admin(current_user) and scope == "all"
    owner_user_id = _owner_id(current_user)
    if _is_admin(current_user) and scope == "guest":
        owner_user_id = None
        include_all = False

    rows = list_report_exports(limit=limit, owner_user_id=owner_user_id, include_all=include_all)
    return {
        "items": [
            {
                "id": int(r["id"]),
                "owner_user_id": r.get("owner_user_id"),
                "task_id": r.get("task_id"),
                "project_id": r.get("project_id"),
                "status": r.get("status"),
                "format": r.get("format"),
                "filename": r.get("filename"),
                "path": r.get("path"),
                "summary_json": _normalize(r.get("summary_json")),
                "error_text": r.get("error_text"),
                "created_at": r.get("created_at"),
            }
            for r in rows
        ]
    }


def get_report_payload(report_id: int, current_user: dict | None = None):
    row = get_report_export(
        report_id=report_id,
        owner_user_id=_owner_id(current_user),
        include_all=_is_admin(current_user),
    )
    if not row:
        raise HTTPException(status_code=404, detail="report not found")
    return {
        "id": int(row["id"]),
        "owner_user_id": row.get("owner_user_id"),
        "task_id": row.get("task_id"),
        "project_id": row.get("project_id"),
        "status": row.get("status"),
        "format": row.get("format"),
        "filename": row.get("filename"),
        "path": row.get("path"),
        "summary_json": _normalize(row.get("summary_json")),
        "error_text": row.get("error_text"),
        "created_at": row.get("created_at"),
    }
