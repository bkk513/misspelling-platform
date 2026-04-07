import json
import math
import random
from collections import defaultdict

import numpy as np
import pandas as pd
from fastapi import HTTPException
from scipy import stats
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import silhouette_score
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from sqlalchemy import text

from ..db.audit_logs_repo import insert_audit_log
from ..db.core import get_engine
from ..db.projects_repo import (
    get_project,
    get_or_create_project_cohort,
    list_project_term_memberships,
    term_stats_for_project,
    term_time_series_for_project,
    upsert_project_term_memberships,
)

DEMO_COHORT_COLORS = ["#1164d6", "#0f766e", "#d97706", "#dc2626", "#7c3aed", "#0ea5e9"]


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _ensure_project_access(project_id: int, current_user: dict | None):
    if current_user is None:
        raise HTTPException(status_code=403, detail="login required for analytics workspace")
    row = get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="project not found")
    if _is_admin(current_user):
        return row
    owner_user_id = row.get("owner_user_id")
    uid = _owner_id(current_user)
    if uid is not None and owner_user_id == uid:
        return row
    raise HTTPException(status_code=403, detail="forbidden")


def _cohort_code(name: str) -> float:
    key = str(name or "").strip().lower()
    if not key:
        return 0.0
    acc = 0
    for i, ch in enumerate(key):
        acc += (i + 1) * ord(ch)
    return float((acc % 997) / 997.0)


def _membership_maps(project_id: int):
    rows = [dict(r) for r in list_project_term_memberships(project_id)]
    by_term: dict[int, list[dict]] = defaultdict(list)
    cohort_to_terms: dict[str, set[int]] = defaultdict(set)
    for row in rows:
        term_id = int(row.get("term_id") or 0)
        cohort_name = str(row.get("cohort_name") or "custom")
        if term_id <= 0:
            continue
        item = {
            "cohort_id": int(row.get("cohort_id") or 0),
            "cohort_name": cohort_name,
            "weight": float(row.get("membership_weight") or 1.0),
            "confidence": float(row.get("confidence") or 1.0),
            "source": str(row.get("source") or "manual"),
        }
        by_term[term_id].append(item)
        cohort_to_terms[cohort_name].add(term_id)

    for term_id in list(by_term.keys()):
        by_term[term_id] = sorted(by_term[term_id], key=lambda x: (x["weight"], x["confidence"]), reverse=True)

    return by_term, cohort_to_terms


def _feature_rows_from_project(project_id: int, owner_user_id: int | None = None):
    rows = term_stats_for_project(project_id, owner_user_id=owner_user_id)
    memberships_by_term, _ = _membership_maps(project_id)
    points = []
    for row in rows:
        term_id = int(row["term_id"])
        variants_count = float(row.get("variants_count") or 0)
        avg_value = float(row.get("avg_value") or 0)
        points_count = float(row.get("points_count") or 0)
        canonical = str(row.get("canonical") or "")
        category = str(row.get("category") or "custom")
        memberships = memberships_by_term.get(term_id, [])
        primary_cohort = memberships[0]["cohort_name"] if memberships else category
        cohort_count = len(memberships)

        features = [
            float(len(canonical)),
            variants_count,
            avg_value,
            points_count,
            math.log1p(points_count),
            float(cohort_count),
            _cohort_code(primary_cohort),
        ]
        points.append(
            {
                "term_id": term_id,
                "canonical": canonical,
                "category": category,
                "primary_cohort": primary_cohort,
                "cohort_names": [m["cohort_name"] for m in memberships],
                "features": features,
                "stats": {
                    "variants_count": variants_count,
                    "avg_value": avg_value,
                    "points_count": points_count,
                    "length": float(len(canonical)),
                },
            }
        )
    return points


def _distance(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _kmeans_baseline(points: list[dict], k: int):
    if not points:
        return []
    k = max(1, min(int(k), len(points)))
    rng = random.Random(42)
    centroids = [p["features"][:] for p in rng.sample(points, k)]
    labels = [0 for _ in points]

    for _ in range(20):
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
                "items": [
                    {
                        "term_id": t["term_id"],
                        "canonical": t["canonical"],
                        "category": t["category"],
                        "primary_cohort": t.get("primary_cohort"),
                    }
                    for t in items
                ],
            }
        )
    return clusters


def _kmeans_advanced(points: list[dict], k: int):
    if not points:
        return {
            "clusters": [],
            "diagnostics": {"silhouette": None, "pca_explained_variance": []},
        }

    X = np.array([p["features"] for p in points], dtype=float)
    n_samples = X.shape[0]
    if n_samples == 1:
        return {
            "clusters": [
                {
                    "cluster_id": 0,
                    "size": 1,
                    "items": [
                        {
                            "term_id": points[0]["term_id"],
                            "canonical": points[0]["canonical"],
                            "category": points[0]["category"],
                            "primary_cohort": points[0].get("primary_cohort"),
                            "embedding": {"x": 0.0, "y": 0.0},
                        }
                    ],
                    "centroid": [float(v) for v in points[0]["features"]],
                }
            ],
            "diagnostics": {"silhouette": None, "pca_explained_variance": []},
        }

    k_safe = max(2, min(int(k), n_samples))
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    model = KMeans(n_clusters=k_safe, random_state=42, n_init=20)
    labels = model.fit_predict(Xs)

    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(Xs)
    explained = [float(v) for v in pca.explained_variance_ratio_.tolist()]

    silhouette = None
    if len(set(labels.tolist())) > 1:
        silhouette = float(silhouette_score(Xs, labels))

    clusters = []
    for ci in sorted(set(labels.tolist())):
        idxs = [i for i, label in enumerate(labels.tolist()) if label == ci]
        items = []
        for i in idxs:
            items.append(
                {
                    "term_id": points[i]["term_id"],
                    "canonical": points[i]["canonical"],
                    "category": points[i]["category"],
                    "primary_cohort": points[i].get("primary_cohort"),
                    "embedding": {"x": float(coords[i, 0]), "y": float(coords[i, 1])},
                }
            )
        centroid_raw = scaler.inverse_transform(model.cluster_centers_[ci].reshape(1, -1))[0]
        clusters.append(
            {
                "cluster_id": int(ci),
                "size": len(items),
                "items": items,
                "centroid": [float(v) for v in centroid_raw.tolist()],
            }
        )

    return {
        "clusters": clusters,
        "diagnostics": {
            "silhouette": silhouette,
            "pca_explained_variance": explained,
        },
    }


def _store_run(owner_user_id: int | None, project_id: int, method: str, params: dict, result: dict):
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
                "method": method,
                "params_json": json.dumps(params),
                "result_json": json.dumps(result),
            },
        )


def _cluster_result_from_points(project_id: int, points: list[dict], k: int, method: str = "kmeans_advanced"):
    if method == "baseline-kmeans":
        clusters = _kmeans_baseline(points, k)
        diagnostics = {"silhouette": None, "pca_explained_variance": []}
    elif method in {"kmeans_advanced", "kmeans"}:
        advanced = _kmeans_advanced(points, k)
        clusters = advanced["clusters"]
        diagnostics = advanced["diagnostics"]
        method = "kmeans_advanced"
    else:
        raise HTTPException(status_code=400, detail="unsupported method")

    return {
        "method": method,
        "project_id": project_id,
        "k": max(1, min(int(k), 8)),
        "features": [
            "length",
            "variants_count",
            "avg_value",
            "points_count",
            "log_points_count",
            "cohort_count",
            "cohort_code",
        ],
        "clusters": clusters,
        "diagnostics": diagnostics,
        "terms": len(points),
    }


def cluster_payload(project_id: int, k: int, current_user: dict | None, method: str = "kmeans_advanced"):
    project = _ensure_project_access(project_id, current_user)
    project_owner_user_id = int(project.get("owner_user_id") or 0) or None
    points = _feature_rows_from_project(project_id, owner_user_id=project_owner_user_id)
    owner_user_id = _owner_id(current_user)
    result = _cluster_result_from_points(project_id=project_id, points=points, k=k, method=method)

    _store_run(
        owner_user_id=owner_user_id,
        project_id=project_id,
        method=str(result["method"]),
        params={"k": k, "method": result["method"]},
        result=result,
    )
    insert_audit_log(
        action="ANALYTICS_CLUSTER",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"k": k, "terms": len(points), "method": result["method"]},
    )
    return result


def bootstrap_demo_cohorts_payload(project_id: int, k: int, current_user: dict | None, method: str = "kmeans_advanced"):
    project = _ensure_project_access(project_id, current_user)
    project_owner_user_id = int(project.get("owner_user_id") or 0) or None
    points = _feature_rows_from_project(project_id, owner_user_id=project_owner_user_id)
    owner_user_id = _owner_id(current_user)
    if len(points) < 2:
        raise HTTPException(status_code=400, detail="at least two terms are required for demo cohort bootstrap")

    cluster_result = _cluster_result_from_points(project_id=project_id, points=points, k=max(2, k), method=method)
    clusters = list(cluster_result.get("clusters") or [])
    if len(clusters) < 2:
        raise HTTPException(status_code=400, detail="demo cohort bootstrap requires at least two clusters")

    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                DELETE FROM project_cohorts
                WHERE project_id = :project_id
                  AND name LIKE 'demo_cluster_%'
                """
            ),
            {"project_id": project_id},
        )

    silhouette = cluster_result.get("diagnostics", {}).get("silhouette")
    confidence = 0.72
    if isinstance(silhouette, (int, float)) and math.isfinite(float(silhouette)):
        confidence = max(0.60, min(0.92, 0.72 + 0.20 * float(silhouette)))

    created_cohorts: list[dict] = []
    assignments: list[dict] = []
    for index, group in enumerate(clusters, start=1):
        cohort = get_or_create_project_cohort(
            project_id=project_id,
            name=f"demo_cluster_{index}",
            description=f"Auto-bootstrapped from {cluster_result['method']} cluster {group['cluster_id']}",
            color=DEMO_COHORT_COLORS[(index - 1) % len(DEMO_COHORT_COLORS)],
            sort_order=20 + index,
        )
        if not cohort:
            continue
        created_cohorts.append(
            {
                "cohort_id": int(cohort["id"]),
                "name": str(cohort["name"]),
                "color": cohort.get("color"),
                "cluster_id": int(group["cluster_id"]),
                "size": int(group["size"]),
            }
        )
        for item in group.get("items") or []:
            assignments.append(
                {
                    "term_id": int(item["term_id"]),
                    "cohort_id": int(cohort["id"]),
                    "membership_weight": 1.10,
                    "source": "cluster-bootstrap",
                    "confidence": max(confidence, 0.96),
                    "note": f"Auto-generated from {cluster_result['method']} cluster {group['cluster_id']}",
                }
            )

    assigned = upsert_project_term_memberships(project_id, assignments)
    created_cohorts = sorted(created_cohorts, key=lambda item: (-int(item["size"]), str(item["name"])))
    recommended_pair = [item["name"] for item in created_cohorts[:2]]
    target_cohort = recommended_pair[0] if recommended_pair else (created_cohorts[0]["name"] if created_cohorts else None)

    result = {
        "method": "cluster-demo-cohort-bootstrap",
        "project_id": project_id,
        "source_cluster_method": cluster_result["method"],
        "k": int(cluster_result["k"]),
        "terms": int(cluster_result["terms"]),
        "assignments": int(assigned),
        "diagnostics": cluster_result.get("diagnostics") or {},
        "created_cohorts": created_cohorts,
        "recommended_pair": recommended_pair,
        "target_cohort": target_cohort,
        "warnings": [],
    }

    _store_run(
        owner_user_id=owner_user_id,
        project_id=project_id,
        method="cluster-demo-cohort-bootstrap",
        params={"k": k, "method": cluster_result["method"]},
        result=result,
    )
    insert_audit_log(
        action="ANALYTICS_BOOTSTRAP_DEMO_COHORTS",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={
            "k": cluster_result["k"],
            "terms": len(points),
            "created_cohorts": len(created_cohorts),
            "method": cluster_result["method"],
        },
    )
    return result


def _cohen_d(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    var_a = np.var(a, ddof=1)
    var_b = np.var(b, ddof=1)
    pooled = (((len(a) - 1) * var_a) + ((len(b) - 1) * var_b)) / max(1, (len(a) + len(b) - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((np.mean(a) - np.mean(b)) / math.sqrt(pooled))


def _permutation_pvalue(a: np.ndarray, b: np.ndarray, permutations: int, rng: np.random.Generator) -> float:
    observed = abs(float(np.mean(a) - np.mean(b)))
    combined = np.concatenate([a, b]).copy()
    na = len(a)
    exceed = 0
    for _ in range(permutations):
        rng.shuffle(combined)
        diff = abs(float(np.mean(combined[:na]) - np.mean(combined[na:])))
        if diff >= observed:
            exceed += 1
    return float((exceed + 1) / (permutations + 1))


def _bootstrap_ci_diff(a: np.ndarray, b: np.ndarray, bootstrap: int, rng: np.random.Generator):
    if len(a) == 0 or len(b) == 0:
        return [0.0, 0.0]
    samples = []
    for _ in range(bootstrap):
        sa = rng.choice(a, size=len(a), replace=True)
        sb = rng.choice(b, size=len(b), replace=True)
        samples.append(float(np.mean(sa) - np.mean(sb)))
    arr = np.array(samples, dtype=float)
    return [float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5))]


def _fdr_bh(p_values: list[float]) -> list[float]:
    n = len(p_values)
    if n == 0:
        return []
    ranked = sorted(enumerate(p_values), key=lambda x: x[1])
    out = [1.0] * n
    prev = 1.0
    for i in range(n - 1, -1, -1):
        idx, p = ranked[i]
        rank = i + 1
        q = min(prev, (p * n) / rank)
        out[idx] = float(max(0.0, min(1.0, q)))
        prev = q
    return out


def cohort_compare_payload(
    project_id: int,
    cohort_a: str,
    cohort_b: str,
    permutations: int,
    bootstrap: int,
    current_user: dict | None,
):
    project = _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)

    _, cohort_map = _membership_maps(project_id)
    a_name = str(cohort_a or "").strip()
    b_name = str(cohort_b or "").strip()
    if not a_name or not b_name or a_name == b_name:
        raise HTTPException(status_code=400, detail="invalid cohort pair")

    term_ids_a = cohort_map.get(a_name, set())
    term_ids_b = cohort_map.get(b_name, set())
    if not term_ids_a or not term_ids_b:
        raise HTTPException(status_code=400, detail="cohort has no terms")

    points = _feature_rows_from_project(
        project_id,
        owner_user_id=int(project.get("owner_user_id") or 0) or None,
    )
    by_term = {int(p["term_id"]): p for p in points}

    metrics = {
        "avg_value": lambda p: float(p["stats"]["avg_value"]),
        "points_count": lambda p: float(p["stats"]["points_count"]),
        "variants_count": lambda p: float(p["stats"]["variants_count"]),
        "length": lambda p: float(p["stats"]["length"]),
    }

    rng = np.random.default_rng(42)
    metric_rows = []
    for metric_name, getter in metrics.items():
        va = np.array([getter(by_term[t]) for t in term_ids_a if t in by_term], dtype=float)
        vb = np.array([getter(by_term[t]) for t in term_ids_b if t in by_term], dtype=float)
        if len(va) == 0 or len(vb) == 0:
            continue

        mean_a = float(np.mean(va))
        mean_b = float(np.mean(vb))
        diff = mean_a - mean_b
        p_value = _permutation_pvalue(va, vb, max(200, min(int(permutations), 8000)), rng)
        ci = _bootstrap_ci_diff(va, vb, max(200, min(int(bootstrap), 5000)), rng)
        t_stat, t_p = stats.ttest_ind(va, vb, equal_var=False)
        metric_rows.append(
            {
                "metric": metric_name,
                "n_a": int(len(va)),
                "n_b": int(len(vb)),
                "mean_a": mean_a,
                "mean_b": mean_b,
                "diff_mean": float(diff),
                "effect_size_d": _cohen_d(va, vb),
                "perm_p_value": float(p_value),
                "welch_t": float(t_stat) if np.isfinite(t_stat) else 0.0,
                "welch_p_value": float(t_p) if np.isfinite(t_p) else 1.0,
                "bootstrap_ci95": ci,
            }
        )

    q_values = _fdr_bh([float(r["perm_p_value"]) for r in metric_rows])
    for idx, q in enumerate(q_values):
        metric_rows[idx]["fdr_q_value"] = q
        metric_rows[idx]["is_significant"] = bool(q < 0.05)

    result = {
        "method": "cohort-permutation-bootstrap",
        "project_id": project_id,
        "cohort_a": a_name,
        "cohort_b": b_name,
        "overlap_terms": int(len(set(term_ids_a).intersection(set(term_ids_b)))),
        "cohort_sizes": {a_name: int(len(term_ids_a)), b_name: int(len(term_ids_b))},
        "metrics": metric_rows,
    }

    _store_run(
        owner_user_id=owner_user_id,
        project_id=project_id,
        method="cohort-permutation-bootstrap",
        params={"cohort_a": a_name, "cohort_b": b_name, "permutations": permutations, "bootstrap": bootstrap},
        result=result,
    )
    insert_audit_log(
        action="ANALYTICS_COHORT_COMPARE",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"cohort_a": a_name, "cohort_b": b_name},
    )
    return result


def _dtw_distance(a: np.ndarray, b: np.ndarray, window: int = 6) -> float:
    n, m = len(a), len(b)
    w = max(window, abs(n - m))
    dtw = np.full((n + 1, m + 1), np.inf, dtype=float)
    dtw[0, 0] = 0.0
    for i in range(1, n + 1):
        start = max(1, i - w)
        end = min(m + 1, i + w + 1)
        for j in range(start, end):
            cost = abs(a[i - 1] - b[j - 1])
            dtw[i, j] = cost + min(dtw[i - 1, j], dtw[i, j - 1], dtw[i - 1, j - 1])
    return float(dtw[n, m])


def temporal_patterns_payload(project_id: int, n_clusters: int, limit_terms: int, current_user: dict | None):
    project = _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)

    rows = [
        dict(r)
        for r in term_time_series_for_project(
            project_id=project_id,
            limit_terms=limit_terms,
            owner_user_id=int(project.get("owner_user_id") or 0) or None,
        )
    ]
    if not rows:
        result = {
            "method": "dtw-agglomerative",
            "project_id": project_id,
            "n_clusters": 0,
            "year_range": [],
            "clusters": [],
            "warnings": ["no_time_series_data"],
        }
        _store_run(owner_user_id=owner_user_id, project_id=project_id, method="dtw-agglomerative", params={"n_clusters": n_clusters}, result=result)
        return result

    frame = pd.DataFrame(rows)
    frame["year"] = frame["year"].astype(int)
    frame["value"] = frame["value"].astype(float)

    pivot = frame.pivot_table(index=["term_id", "canonical"], columns="year", values="value", aggfunc="mean", fill_value=0.0)
    years = [int(y) for y in pivot.columns.tolist()]
    raw_matrix = np.log1p(pivot.to_numpy(dtype=float))

    row_mean = np.mean(raw_matrix, axis=1, keepdims=True)
    row_std = np.std(raw_matrix, axis=1, keepdims=True)
    row_std[row_std < 1e-9] = 1.0
    normalized = (raw_matrix - row_mean) / row_std

    n_terms = normalized.shape[0]
    if n_terms == 1:
        term_id, canonical = pivot.index.tolist()[0]
        trajectory = [{"year": int(y), "value": float(v)} for y, v in zip(years, raw_matrix[0].tolist())]
        result = {
            "method": "dtw-agglomerative",
            "project_id": project_id,
            "n_clusters": 1,
            "year_range": years,
            "clusters": [
                {
                    "cluster_id": 0,
                    "size": 1,
                    "medoid_term_id": int(term_id),
                    "medoid_canonical": str(canonical),
                    "terms": [{"term_id": int(term_id), "canonical": str(canonical)}],
                    "mean_trajectory": trajectory,
                }
            ],
            "warnings": [],
        }
        _store_run(owner_user_id=owner_user_id, project_id=project_id, method="dtw-agglomerative", params={"n_clusters": 1}, result=result)
        return result

    distance = np.zeros((n_terms, n_terms), dtype=float)
    for i in range(n_terms):
        for j in range(i + 1, n_terms):
            d = _dtw_distance(normalized[i], normalized[j])
            distance[i, j] = d
            distance[j, i] = d

    k = max(2, min(int(n_clusters), n_terms))
    model = AgglomerativeClustering(n_clusters=k, metric="precomputed", linkage="average")
    labels = model.fit_predict(distance)

    index_rows = pivot.index.tolist()
    clusters = []
    for cid in sorted(set(labels.tolist())):
        members = [i for i, label in enumerate(labels.tolist()) if label == cid]
        if not members:
            continue
        local_dist = distance[np.ix_(members, members)]
        medoid_local_index = int(np.argmin(np.mean(local_dist, axis=1)))
        medoid_idx = members[medoid_local_index]
        medoid_term_id, medoid_canonical = index_rows[medoid_idx]

        mean_traj = np.mean(raw_matrix[members], axis=0)
        clusters.append(
            {
                "cluster_id": int(cid),
                "size": len(members),
                "medoid_term_id": int(medoid_term_id),
                "medoid_canonical": str(medoid_canonical),
                "terms": [
                    {"term_id": int(index_rows[i][0]), "canonical": str(index_rows[i][1])}
                    for i in members
                ],
                "mean_trajectory": [{"year": int(y), "value": float(v)} for y, v in zip(years, mean_traj.tolist())],
            }
        )

    result = {
        "method": "dtw-agglomerative",
        "project_id": project_id,
        "n_clusters": len(clusters),
        "year_range": years,
        "clusters": clusters,
        "warnings": [],
    }

    _store_run(
        owner_user_id=owner_user_id,
        project_id=project_id,
        method="dtw-agglomerative",
        params={"n_clusters": n_clusters, "limit_terms": limit_terms},
        result=result,
    )
    insert_audit_log(
        action="ANALYTICS_TEMPORAL_PATTERNS",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"n_clusters": len(clusters), "terms": n_terms},
    )
    return result


def explainability_payload(project_id: int, target_cohort: str | None, current_user: dict | None):
    project = _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)

    points = _feature_rows_from_project(
        project_id,
        owner_user_id=int(project.get("owner_user_id") or 0) or None,
    )
    if not points:
        return {
            "method": "rf-permutation-importance",
            "project_id": project_id,
            "warnings": ["no_terms"],
            "accuracy": None,
            "feature_importance": [],
            "target_preview": [],
        }

    labels = [str(p.get("primary_cohort") or "custom") for p in points]
    X = np.array([p["features"] for p in points], dtype=float)
    unique_labels = sorted(set(labels))
    if len(unique_labels) < 2:
        return {
            "method": "rf-permutation-importance",
            "project_id": project_id,
            "warnings": ["single_cohort_only"],
            "accuracy": None,
            "feature_importance": [],
            "target_preview": [],
        }

    label_to_idx = {name: idx for idx, name in enumerate(unique_labels)}
    idx_to_label = {idx: name for name, idx in label_to_idx.items()}
    y = np.array([label_to_idx[label] for label in labels], dtype=int)

    model = RandomForestClassifier(
        n_estimators=320,
        random_state=42,
        class_weight="balanced_subsample",
        min_samples_leaf=1,
    )
    model.fit(X, y)

    counts = pd.Series(y).value_counts().to_dict()
    min_class_size = min(int(v) for v in counts.values())
    cv_score = None
    if X.shape[0] >= 12 and min_class_size >= 2:
        folds = min(5, min_class_size)
        if folds >= 2:
            cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
            scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")
            cv_score = {
                "mean": float(np.mean(scores)),
                "std": float(np.std(scores)),
                "folds": int(folds),
            }

    perm = permutation_importance(model, X, y, n_repeats=20, random_state=42, scoring="accuracy")
    feature_names = [
        "length",
        "variants_count",
        "avg_value",
        "points_count",
        "log_points_count",
        "cohort_count",
        "cohort_code",
    ]
    feature_importance = []
    for i, name in enumerate(feature_names):
        feature_importance.append(
            {
                "feature": name,
                "importance_mean": float(perm.importances_mean[i]),
                "importance_std": float(perm.importances_std[i]),
            }
        )
    feature_importance = sorted(feature_importance, key=lambda x: x["importance_mean"], reverse=True)

    probs = model.predict_proba(X)
    target = str(target_cohort or "").strip()
    if target and target in label_to_idx:
        target_idx = label_to_idx[target]
    else:
        largest = sorted(((name, int(sum(1 for yv in y if yv == idx))) for name, idx in label_to_idx.items()), key=lambda x: x[1], reverse=True)
        target = largest[0][0]
        target_idx = label_to_idx[target]

    ranked = sorted(
        [
            {
                "term_id": int(points[i]["term_id"]),
                "canonical": str(points[i]["canonical"]),
                "true_cohort": idx_to_label[int(y[i])],
                "target_probability": float(probs[i, target_idx]),
            }
            for i in range(len(points))
        ],
        key=lambda x: x["target_probability"],
        reverse=True,
    )

    result = {
        "method": "rf-permutation-importance",
        "project_id": project_id,
        "labels": unique_labels,
        "target_cohort": target,
        "accuracy": cv_score,
        "feature_importance": feature_importance,
        "target_preview": ranked[:20],
        "warnings": [],
    }

    _store_run(
        owner_user_id=owner_user_id,
        project_id=project_id,
        method="rf-permutation-importance",
        params={"target_cohort": target},
        result=result,
    )
    insert_audit_log(
        action="ANALYTICS_EXPLAINABILITY",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"target_cohort": target, "terms": len(points)},
    )
    return result


def summary_payload(project_id: int, current_user: dict | None = None):
    project = _ensure_project_access(project_id, current_user)
    rows = term_stats_for_project(project_id, owner_user_id=int(project.get("owner_user_id") or 0) or None)
    memberships_by_term, cohort_to_terms = _membership_maps(project_id)

    total_terms = len(rows)
    total_points = int(sum(int(r.get("points_count") or 0) for r in rows))
    avg_variants = round(sum(float(r.get("variants_count") or 0) for r in rows) / max(1, total_terms), 3)

    by_category: dict[str, int] = {}
    terms_with_points = 0
    memberships_total = 0
    for row in rows:
        cat = str(row.get("category") or "custom")
        by_category[cat] = by_category.get(cat, 0) + 1
        if float(row.get("points_count") or 0) > 0:
            terms_with_points += 1
        memberships_total += len(memberships_by_term.get(int(row.get("term_id") or 0), []))

    cohort_distribution = {str(k): int(len(v)) for k, v in cohort_to_terms.items()}
    coverage_ratio = round(float(terms_with_points / max(1, total_terms)), 4)
    avg_memberships_per_term = round(float(memberships_total / max(1, total_terms)), 4)

    return {
        "project_id": project_id,
        "total_terms": total_terms,
        "total_points": total_points,
        "avg_variants": avg_variants,
        "category_distribution": by_category,
        "total_cohorts": int(len(cohort_distribution)),
        "cohort_distribution": cohort_distribution,
        "terms_with_points": int(terms_with_points),
        "coverage_ratio": coverage_ratio,
        "avg_memberships_per_term": avg_memberships_per_term,
    }
