from sqlalchemy import bindparam, text

from .core import get_engine


def create_project(owner_user_id: int | None, name: str, description: str | None = None):
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO projects (owner_user_id, name, description)
                VALUES (:owner_user_id, :name, :description)
                """
            ),
            {"owner_user_id": owner_user_id, "name": name, "description": description},
        )
        return int(result.lastrowid)


def list_projects(owner_user_id: int | None, include_all: bool = False, limit: int = 100):
    if include_all:
        where = "1=1"
        params = {"limit": limit}
    elif owner_user_id is None:
        where = "owner_user_id IS NULL"
        params = {"limit": limit}
    else:
        where = "owner_user_id = :owner_user_id"
        params = {"owner_user_id": owner_user_id, "limit": limit}
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, owner_user_id, name, description, status, created_at, updated_at
                    FROM projects
                    WHERE {where}
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )


def get_project(project_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, owner_user_id, name, description, status, created_at, updated_at
                    FROM projects
                    WHERE id=:project_id
                    LIMIT 1
                    """
                ),
                {"project_id": project_id},
            )
            .mappings()
            .first()
        )


def add_project_terms(project_id: int, term_ids: list[int], category: str | None = None):
    if not term_ids:
        return 0
    with get_engine().begin() as conn:
        for term_id in term_ids:
            conn.execute(
                text(
                    """
                    INSERT IGNORE INTO project_terms (project_id, term_id, category)
                    VALUES (:project_id, :term_id, :category)
                    """
                ),
                {"project_id": project_id, "term_id": term_id, "category": category},
            )
    return len(term_ids)


def list_project_terms(project_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT pt.id, pt.project_id, pt.term_id, pt.category, lt.canonical
                    FROM project_terms pt
                    JOIN lexicon_terms lt ON lt.id = pt.term_id
                    WHERE pt.project_id=:project_id
                    ORDER BY pt.id ASC
                    """
                ),
                {"project_id": project_id},
            )
            .mappings()
            .all()
        )


def bind_project_task(project_id: int, task_id: str):
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT IGNORE INTO project_tasks (project_id, task_id)
                VALUES (:project_id, :task_id)
                """
            ),
            {"project_id": project_id, "task_id": task_id},
        )


def list_project_tasks(project_id: int, limit: int = 200):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT t.task_id, t.task_type, t.status, t.params_json, t.result_json, t.created_at, t.updated_at
                    FROM project_tasks pt
                    JOIN tasks t ON t.task_id = pt.task_id
                    WHERE pt.project_id=:project_id
                    ORDER BY t.id DESC
                    LIMIT :limit
                    """
                ),
                {"project_id": project_id, "limit": limit},
            )
            .mappings()
            .all()
        )


def term_stats_for_project(project_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      lt.id AS term_id,
                      lt.canonical,
                      lt.category,
                      COALESCE(COUNT(DISTINCT lv.id), 0) AS variants_count,
                      COALESCE(AVG(tp.value), 0) AS avg_value,
                      COALESCE(COUNT(tp.series_id), 0) AS points_count
                    FROM project_terms pt
                    JOIN lexicon_terms lt ON lt.id = pt.term_id
                    LEFT JOIN lexicon_variants lv ON lv.term_id = lt.id
                    LEFT JOIN time_series ts ON ts.term_id = lt.id
                    LEFT JOIN time_series_points tp ON tp.series_id = ts.id
                    WHERE pt.project_id=:project_id
                    GROUP BY lt.id, lt.canonical, lt.category
                    ORDER BY lt.id
                    """
                ),
                {"project_id": project_id},
            )
            .mappings()
            .all()
        )
