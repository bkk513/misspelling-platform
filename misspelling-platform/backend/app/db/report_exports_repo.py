import json

from sqlalchemy import text

from .core import get_engine


def create_report_export(
    owner_user_id: int | None,
    task_id: str | None,
    project_id: int | None,
    report_format: str,
    filename: str,
    path: str,
    summary: dict | None = None,
) -> int:
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO report_exports (
                  owner_user_id, task_id, project_id, status, format, filename, path, summary_json
                ) VALUES (
                  :owner_user_id, :task_id, :project_id, 'READY', :report_format, :filename, :path, :summary_json
                )
                """
            ),
            {
                "owner_user_id": owner_user_id,
                "task_id": task_id,
                "project_id": project_id,
                "report_format": report_format,
                "filename": filename,
                "path": path,
                "summary_json": json.dumps(summary or {}),
            },
        )
        return int(result.lastrowid)


def _scope_where(owner_user_id: int | None, include_all: bool):
    if include_all:
        return "1=1", {}
    if owner_user_id is None:
        return "owner_user_id IS NULL", {}
    return "owner_user_id = :owner_user_id", {"owner_user_id": owner_user_id}


def list_report_exports(limit: int = 100, owner_user_id: int | None = None, include_all: bool = False):
    where, params = _scope_where(owner_user_id, include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, owner_user_id, task_id, project_id, status, format, filename, path, summary_json, error_text, created_at
                    FROM report_exports
                    WHERE {where}
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": max(1, min(int(limit), 500)), **params},
            )
            .mappings()
            .all()
        )


def get_report_export(report_id: int, owner_user_id: int | None = None, include_all: bool = False):
    where, params = _scope_where(owner_user_id, include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, owner_user_id, task_id, project_id, status, format, filename, path, summary_json, error_text, created_at
                    FROM report_exports
                    WHERE id=:report_id AND ({where})
                    LIMIT 1
                    """
                ),
                {"report_id": report_id, **params},
            )
            .mappings()
            .first()
        )
