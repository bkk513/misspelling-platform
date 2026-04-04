import json

from sqlalchemy import bindparam, text

from .core import get_engine


def _owner_scope(alias: str, owner_user_id: int | None, include_all: bool = False):
    prefix = f"{alias}." if alias else ""
    if include_all:
        return "1=1", {}
    if owner_user_id is None:
        return f"{prefix}owner_user_id IS NULL", {}
    return f"{prefix}owner_user_id = :owner_user_id", {"owner_user_id": owner_user_id}


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
                    SELECT
                      t.task_id,
                      t.task_type,
                      t.status,
                      t.params_json,
                      t.result_json,
                      t.created_at,
                      t.updated_at,
                      t.owner_user_id,
                      t.guest_key
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


def term_stats_for_project(project_id: int, owner_user_id: int | None = None, include_all: bool = False):
    variant_where, variant_params = _owner_scope("lv", owner_user_id=owner_user_id, include_all=include_all)
    series_where, series_params = _owner_scope("ts", owner_user_id=owner_user_id, include_all=include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT
                      lt.id AS term_id,
                      lt.canonical,
                      lt.category,
                      COALESCE(COUNT(DISTINCT lv.id), 0) AS variants_count,
                      COALESCE(AVG(tp.value), 0) AS avg_value,
                      COALESCE(COUNT(tp.series_id), 0) AS points_count
                    FROM project_terms pt
                    JOIN lexicon_terms lt ON lt.id = pt.term_id
                    LEFT JOIN lexicon_variants lv ON lv.term_id = lt.id AND ({variant_where})
                    LEFT JOIN time_series ts ON ts.term_id = lt.id AND ({series_where})
                    LEFT JOIN time_series_points tp ON tp.series_id = ts.id
                    WHERE pt.project_id=:project_id
                    GROUP BY lt.id, lt.canonical, lt.category
                    ORDER BY lt.id
                    """
                ),
                {"project_id": project_id, **variant_params, **series_params},
            )
            .mappings()
            .all()
        )


def get_or_create_project_cohort(
    project_id: int,
    name: str,
    description: str | None = None,
    color: str | None = None,
    sort_order: int = 0,
):
    normalized = str(name or "").strip()
    if not normalized:
        return None
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project_cohorts (project_id, name, description, color, sort_order, is_active)
                VALUES (:project_id, :name, :description, :color, :sort_order, 1)
                ON DUPLICATE KEY UPDATE
                  description = COALESCE(VALUES(description), description),
                  color = COALESCE(VALUES(color), color),
                  sort_order = LEAST(sort_order, VALUES(sort_order))
                """
            ),
            {
                "project_id": project_id,
                "name": normalized,
                "description": description,
                "color": color,
                "sort_order": int(sort_order or 0),
            },
        )
        row = (
            conn.execute(
                text(
                    """
                    SELECT id, project_id, name, description, color, sort_order, is_active, created_at, updated_at
                    FROM project_cohorts
                    WHERE project_id=:project_id AND name=:name
                    LIMIT 1
                    """
                ),
                {"project_id": project_id, "name": normalized},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_project_cohorts(project_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, project_id, name, description, color, rule_json, sort_order, is_active, created_at, updated_at
                    FROM project_cohorts
                    WHERE project_id=:project_id
                    ORDER BY sort_order ASC, id ASC
                    """
                ),
                {"project_id": project_id},
            )
            .mappings()
            .all()
        )


def update_project_cohort(
    project_id: int,
    cohort_id: int,
    *,
    name: str | None = None,
    description: str | None = None,
    color: str | None = None,
    rule_json: dict | None = None,
    sort_order: int | None = None,
    is_active: bool | None = None,
) -> bool:
    updates: list[str] = []
    params: dict[str, object] = {"project_id": project_id, "cohort_id": cohort_id}
    if name is not None:
        updates.append("name = :name")
        params["name"] = str(name).strip()
    if description is not None:
        updates.append("description = :description")
        params["description"] = description
    if color is not None:
        updates.append("color = :color")
        params["color"] = color
    if rule_json is not None:
        updates.append("rule_json = :rule_json")
        params["rule_json"] = json.dumps(rule_json)
    if sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = int(sort_order)
    if is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = 1 if bool(is_active) else 0
    if not updates:
        return False
    updates.append("updated_at = CURRENT_TIMESTAMP")
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                f"""
                UPDATE project_cohorts
                SET {', '.join(updates)}
                WHERE project_id=:project_id AND id=:cohort_id
                """
            ),
            params,
        )
        return int(result.rowcount or 0) > 0


def delete_project_cohort(project_id: int, cohort_id: int) -> bool:
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                DELETE FROM project_cohorts
                WHERE project_id=:project_id AND id=:cohort_id
                """
            ),
            {"project_id": project_id, "cohort_id": cohort_id},
        )
        return int(result.rowcount or 0) > 0


def upsert_project_term_memberships(project_id: int, assignments: list[dict]) -> int:
    if not assignments:
        return 0
    count = 0
    with get_engine().begin() as conn:
        for assignment in assignments:
            term_id = int(assignment["term_id"])
            cohort_id = int(assignment["cohort_id"])
            if term_id <= 0 or cohort_id <= 0:
                continue
            weight = float(assignment.get("membership_weight") or 1.0)
            confidence = float(assignment.get("confidence") or 1.0)
            source = str(assignment.get("source") or "manual").strip() or "manual"
            note = assignment.get("note")
            conn.execute(
                text(
                    """
                    INSERT INTO project_term_memberships
                      (project_id, term_id, cohort_id, membership_weight, source, confidence, note)
                    VALUES
                      (:project_id, :term_id, :cohort_id, :membership_weight, :source, :confidence, :note)
                    ON DUPLICATE KEY UPDATE
                      membership_weight=VALUES(membership_weight),
                      source=VALUES(source),
                      confidence=VALUES(confidence),
                      note=VALUES(note),
                      updated_at=CURRENT_TIMESTAMP
                    """
                ),
                {
                    "project_id": project_id,
                    "term_id": term_id,
                    "cohort_id": cohort_id,
                    "membership_weight": weight,
                    "source": source,
                    "confidence": confidence,
                    "note": note,
                },
            )
            count += 1
    return count


def list_project_term_memberships(project_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      ptm.id,
                      ptm.project_id,
                      ptm.term_id,
                      lt.canonical,
                      lt.category AS lexicon_category,
                      ptm.cohort_id,
                      pc.name AS cohort_name,
                      pc.color AS cohort_color,
                      ptm.membership_weight,
                      ptm.source,
                      ptm.confidence,
                      ptm.note,
                      ptm.created_at,
                      ptm.updated_at
                    FROM project_term_memberships ptm
                    JOIN lexicon_terms lt ON lt.id = ptm.term_id
                    JOIN project_cohorts pc ON pc.id = ptm.cohort_id
                    WHERE ptm.project_id=:project_id
                    ORDER BY lt.canonical ASC, ptm.membership_weight DESC, ptm.id ASC
                    """
                ),
                {"project_id": project_id},
            )
            .mappings()
            .all()
        )


def delete_project_term_membership(
    project_id: int,
    *,
    membership_id: int | None = None,
    term_id: int | None = None,
    cohort_id: int | None = None,
) -> int:
    where = ["project_id = :project_id"]
    params: dict[str, object] = {"project_id": project_id}
    if membership_id and membership_id > 0:
        where.append("id = :membership_id")
        params["membership_id"] = membership_id
    if term_id and term_id > 0:
        where.append("term_id = :term_id")
        params["term_id"] = term_id
    if cohort_id and cohort_id > 0:
        where.append("cohort_id = :cohort_id")
        params["cohort_id"] = cohort_id
    if len(where) == 1:
        return 0
    with get_engine().begin() as conn:
        result = conn.execute(
            text(f"DELETE FROM project_term_memberships WHERE {' AND '.join(where)}"),
            params,
        )
        return int(result.rowcount or 0)


def term_time_series_for_project(
    project_id: int,
    limit_terms: int = 160,
    owner_user_id: int | None = None,
    include_all: bool = False,
):
    safe_limit = max(20, min(int(limit_terms or 160), 400))
    series_where, series_params = _owner_scope("ts", owner_user_id=owner_user_id, include_all=include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT
                      lt.id AS term_id,
                      lt.canonical,
                      YEAR(tp.t) AS year,
                      AVG(tp.value) AS value
                    FROM (
                      SELECT term_id
                      FROM project_terms
                      WHERE project_id = :project_id
                      GROUP BY term_id
                      ORDER BY term_id
                      LIMIT :safe_limit
                    ) chosen
                    JOIN lexicon_terms lt ON lt.id = chosen.term_id
                    JOIN time_series ts ON ts.term_id = lt.id AND ({series_where})
                    JOIN time_series_points tp ON tp.series_id = ts.id
                    GROUP BY lt.id, lt.canonical, YEAR(tp.t)
                    ORDER BY lt.id ASC, year ASC
                    """
                ),
                {"project_id": project_id, "safe_limit": safe_limit, **series_params},
            )
            .mappings()
            .all()
        )
