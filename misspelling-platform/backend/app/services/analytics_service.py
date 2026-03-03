import json
import math
import random

from fastapi import HTTPException
from sqlalchemy import text

from ..db.audit_logs_repo import insert_audit_log
from ..db.core import get_engine
from ..db.projects_repo import get_project, term_stats_for_project


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _ensure_project_access(project_id: int, current_user: dict | None):
    row = get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="project not found")
    if _is_admin(current_user):
        return row
    owner_user_id = row.get("owner_user_id")
    uid = _owner_id(current_user)
    if uid is None and owner_user_id is None:
        return row
    if uid is not None and owner_user_id == uid:
        return row
    raise HTTPException(status_code=403, detail="forbidden")


def _feature_rows_from_project(project_id: int):
    rows = term_stats_for_project(project_id)
    points = []
    for row in rows:
        variants_count = float(row.get("variants_count") or 0)
        avg_value = float(row.get("avg_value") or 0)
        points_count = float(row.get("points_count") or 0)
        length = float(len(str(row.get("canonical") or "")))
        category = str(row.get("category") or "custom")
        category_code = {
            "brand": 0.2,
            "science": 0.6,
            "common": 0.4,
            "custom": 0.8,
        }.get(category, 0.8)
        points.append(
            {
                "term_id": int(row["term_id"]),
                "canonical": row["canonical"],
                "category": category,
                "features": [length, variants_count, avg_value, points_count, category_code],
            }
        )
    return points


def _distance(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _kmeans(points: list[dict], k: int):
    if not points:
        return []
    k = max(1, min(int(k), len(points)))
    rng = random.Random(42)
    centroids = [p["features"][:] for p in rng.sample(points, k)]
    labels = [0 for _ in points]

    for _ in range(15):
        changed = False
        for idx, point in enumerate(points):
            distances = [_distance(point["features"], c) for c in centroids]
            label = distances.index(min(distances))
            if labels[idx] != label:
                changed = True
            labels[idx] = label

        if not changed:
            break

        for ci in range(k):
            members = [p["features"] for i, p in enumerate(points) if labels[i] == ci]
            if not members:
                continue
            centroids[ci] = [sum(v[i] for v in members) / len(members) for i in range(len(members[0]))]

    clusters = []
    for ci in range(k):
        items = [points[i] for i in range(len(points)) if labels[i] == ci]
        clusters.append(
            {
                "cluster_id": ci,
                "size": len(items),
                "items": [{"term_id": t["term_id"], "canonical": t["canonical"], "category": t["category"]} for t in items],
            }
        )
    return clusters


def cluster_payload(project_id: int, k: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    points = _feature_rows_from_project(project_id)
    clusters = _kmeans(points, k)
    owner_user_id = _owner_id(current_user)
    result = {
        "method": "baseline-kmeans",
        "project_id": project_id,
        "k": max(1, min(int(k), 8)),
        "features": ["length", "variants_count", "avg_value", "points_count", "category_code"],
        "clusters": clusters,
    }
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO analytics_runs (owner_user_id, project_id, status, method, params_json, result_json)
                VALUES (:owner_user_id, :project_id, 'SUCCESS', :method, :params_json, :result_json)
                """
            ),
            {
                "owner_user_id": owner_user_id,
                "project_id": project_id,
                "method": "baseline-kmeans",
                "params_json": json.dumps({"k": k}),
                "result_json": json.dumps(result),
            },
        )
    insert_audit_log(
        action="ANALYTICS_CLUSTER",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"k": k, "terms": len(points)},
    )
    return result


def summary_payload(project_id: int, current_user: dict | None = None):
    _ensure_project_access(project_id, current_user)
    rows = term_stats_for_project(project_id)
    total_terms = len(rows)
    total_points = int(sum(int(r.get("points_count") or 0) for r in rows))
    avg_variants = round(sum(float(r.get("variants_count") or 0) for r in rows) / max(1, total_terms), 3)
    by_category = {}
    for row in rows:
        cat = str(row.get("category") or "custom")
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "project_id": project_id,
        "total_terms": total_terms,
        "total_points": total_points,
        "avg_variants": avg_variants,
        "category_distribution": by_category,
    }
