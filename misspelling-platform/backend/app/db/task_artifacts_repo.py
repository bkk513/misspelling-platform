from sqlalchemy import text

from .core import engine


def upsert_artifact(
    task_id: str,
    kind: str,
    filename: str,
    path: str,
    meta_json: str | None = None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO task_artifacts (task_id, kind, filename, path, meta_json)
                VALUES (:task_id, :kind, :filename, :path, :meta_json)
                ON DUPLICATE KEY UPDATE
                  path=VALUES(path),
                  meta_json=VALUES(meta_json)
                """
            ),
            {
                "task_id": task_id,
                "kind": kind,
                "filename": filename,
                "path": path,
                "meta_json": meta_json,
            },
        )


def list_artifacts(task_id: str):
    with engine.begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT task_id, kind, filename, path, meta_json, created_at
                    FROM task_artifacts
                    WHERE task_id=:task_id
                    ORDER BY id ASC
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .all()
        )
