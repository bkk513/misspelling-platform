from sqlalchemy import text

from .core import engine


def upsert_artifact(
    task_id: str,
    kind: str,
    filename: str,
    path: str,
    meta_json: str | None = None,
    owner_user_id: int | None = None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO task_artifacts (task_id, kind, filename, path, meta_json, owner_user_id)
                VALUES (:task_id, :kind, :filename, :path, :meta_json, :owner_user_id)
                ON DUPLICATE KEY UPDATE
                  path=VALUES(path),
                  meta_json=VALUES(meta_json),
                  owner_user_id=VALUES(owner_user_id)
                """
            ),
            {
                "task_id": task_id,
                "kind": kind,
                "filename": filename,
                "path": path,
                "meta_json": meta_json,
                "owner_user_id": owner_user_id,
            },
        )


def list_artifacts(task_id: str, owner_user_id: int | None = None, include_all: bool = False):
    owner_where = ""
    params = {"task_id": task_id}
    if not include_all:
        if owner_user_id is None:
            owner_where = " AND owner_user_id IS NULL"
        else:
            owner_where = " AND owner_user_id = :owner_user_id"
            params["owner_user_id"] = owner_user_id
    with engine.begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT task_id, kind, filename, path, meta_json, created_at
                    FROM task_artifacts
                    WHERE task_id=:task_id
                    """
                    + owner_where
                    + """
                    ORDER BY id ASC
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )
