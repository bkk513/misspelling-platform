"""文件说明：GBNC 数据服务模块，负责词频快照拉取、缓存复用、权限隔离与预览数据整理。"""

import json
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from ..db.audit_logs_repo import insert_audit_log
from ..db.core import get_engine
from ..db.data_sources_repo import ensure_data_source
from ..db.time_series_repo import create_series, ensure_term, ensure_variant, insert_series_points
from .gbnc_service import pull_gbnc_with_fallback


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _normalize_guest_key(guest_key: str | None) -> str:
    return str(guest_key or "").strip()[:64]


def _normalize_task_id(value: Any) -> str:
    task_id = str(value or "").strip()
    if task_id.lower() in {"", "null", "none"}:
        return ""
    return task_id


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


def _parse_meta(meta_json: Any) -> dict[str, Any]:
    if isinstance(meta_json, dict):
        return dict(meta_json)
    if isinstance(meta_json, str):
        try:
            parsed = json.loads(meta_json)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _owner_where(owner_user_id: int | None, include_all: bool):
    if include_all:
        return "1=1", {}
    if owner_user_id is None:
        return "ts.owner_user_id IS NULL", {}
    return "ts.owner_user_id = :owner_user_id", {"owner_user_id": owner_user_id}


def _series_rows_for_signature(
    canonical: str,
    source_id: int,
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    owner_user_id: int | None,
    include_all: bool,
):
    where_owner, owner_params = _owner_where(owner_user_id, include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT
                      ts.id,
                      ts.owner_user_id,
                      ts.term_id,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), lt.canonical) AS variant,
                      COALESCE((SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id), 0) AS point_count
                    FROM time_series ts
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    WHERE lt.canonical=:canonical
                      AND ts.source_id=:source_id
                      AND ts.granularity='year'
                      AND ts.window_start=:window_start
                      AND ts.window_end=:window_end
                      AND COALESCE(
                            NULLIF(LOWER(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id'))), 'null'),
                            NULLIF(LOWER(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id'))), 'none'),
                            ''
                          ) = ''
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.corpus')), '')=:corpus
                      AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.smoothing')) AS SIGNED), -1)=:smoothing
                      AND ({where_owner})
                    ORDER BY ts.id ASC
                    """
                ),
                {
                    "canonical": canonical,
                    "source_id": source_id,
                    "window_start": date(start_year, 1, 1),
                    "window_end": date(end_year, 1, 1),
                    "corpus": corpus,
                    "smoothing": int(smoothing),
                    **owner_params,
                },
            )
            .mappings()
            .all()
        )


def _normalize_variants(word: str, variants: list[str] | None):
    values: list[str] = []
    for raw in [word, *((variants or []))]:
        value = str(raw or "").strip().lower()
        if value and value not in values:
            values.append(value)
    return values


def _dedupe_series_rows(rows: list[Any]) -> list[Any]:
    seen: set[str] = set()
    picked: list[Any] = []
    for row in reversed(list(rows)):
        variant = str(row.get("variant") or "").strip().lower()
        if variant in seen:
            continue
        seen.add(variant)
        picked.append(row)
    picked.reverse()
    return picked


def _series_points(series_id: int):
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text("SELECT t, value FROM time_series_points WHERE series_id=:series_id ORDER BY t"),
                {"series_id": series_id},
            )
            .mappings()
            .all()
        )
    return [{"time": str(r["t"]), "value": float(r["value"])} for r in rows]


def pull_gbnc_series_payload(
    word: str,
    variants: list[str] | None,
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    current_user: dict | None = None,
    guest_key: str | None = None,
):
    canonical = str(word or "").strip().lower()
    if not canonical:
        raise HTTPException(status_code=400, detail="word is required")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")

    owner_user_id = _owner_id(current_user)
    include_all = _is_admin(current_user)
    source_id = ensure_data_source(name="GBNC", granularity="year")
    expected_variants = _normalize_variants(canonical, variants)
    existing = _series_rows_for_signature(
        canonical=canonical,
        source_id=source_id,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        owner_user_id=owner_user_id,
        include_all=include_all,
    )
    existing = _dedupe_series_rows(existing)
    existing_by_variant = {str(r["variant"]).lower(): r for r in existing}
    cache_hit = bool(existing) and all(v in existing_by_variant for v in expected_variants)
    if cache_hit:
        point_count = int(sum(int(r.get("point_count") or 0) for r in existing))
        insert_audit_log(
            action="DATA_PULL_GBNC_CACHE_HIT",
            actor_user_id=owner_user_id,
            target_type="gbnc",
            target_id=canonical,
            meta={
                "series": len(existing),
                "points": point_count,
                "corpus": corpus,
                "smoothing": smoothing,
                "start_year": start_year,
                "end_year": end_year,
            },
        )
        return {
            "word": canonical,
            "source": "GBNC",
            "cache_hit": True,
            "warnings": [],
            "series_ids": [int(r["id"]) for r in existing],
            "series_id": int(existing[0]["id"]),
            "point_count": point_count,
        }

    pulled = pull_gbnc_with_fallback(
        term=canonical,
        variants=[v for v in expected_variants if v != canonical],
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        actor_user_id=owner_user_id,
    )
    term_id = ensure_term(canonical=canonical, category="custom", language="en", owner_user_id=owner_user_id)
    created_ids: list[int] = []
    total_points = 0
    for item in pulled.get("series") or []:
        variant = str(item.get("variant") or canonical).strip().lower() or canonical
        variant_id = None if variant == canonical else ensure_variant(term_id, variant, owner_user_id=owner_user_id)
        series_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="year",
            window_start=date(start_year, 1, 1),
            window_end=date(end_year, 1, 1),
            units=str(pulled.get("unit") or "relative_frequency"),
            meta={
                "source": pulled.get("source"),
                "variant": variant,
                "corpus": corpus,
                "smoothing": int(smoothing),
                "pull_start_year": int(start_year),
                "pull_end_year": int(end_year),
                "pulled_at": datetime.now(timezone.utc).isoformat(),
                "warnings": pulled.get("warnings") or [],
                "error_reason": pulled.get("error_reason"),
            },
            owner_user_id=owner_user_id,
        )
        points = []
        for p in item.get("points") or []:
            year = p.get("year")
            if year is None:
                continue
            points.append({"t": date(int(year), 1, 1), "value": float(p.get("value") or 0.0)})
        if points:
            insert_series_points(series_id, points)
        total_points += len(points)
        created_ids.append(series_id)

    insert_audit_log(
        action="DATA_PULL_GBNC_IMPORT",
        actor_user_id=owner_user_id,
        target_type="gbnc",
        target_id=canonical,
        meta={
            "source": pulled.get("source"),
            "series": len(created_ids),
            "points": total_points,
            "warnings": pulled.get("warnings") or [],
            "error_reason": pulled.get("error_reason"),
            "corpus": corpus,
            "smoothing": smoothing,
            "start_year": start_year,
            "end_year": end_year,
        },
    )
    return {
        "word": canonical,
        "source": pulled.get("source"),
        "cache_hit": False,
        "warnings": pulled.get("warnings") or [],
        "error_reason": pulled.get("error_reason"),
        "series_ids": created_ids,
        "series_id": int(created_ids[0]) if created_ids else None,
        "point_count": total_points,
    }


def pull_gbnc_snapshot_payload(
    word: str,
    variants: list[str] | None,
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    current_user: dict | None = None,
    guest_key: str | None = None,
):
    pulled = pull_gbnc_series_payload(
        word=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
        guest_key=guest_key,
    )
    hydrated = _hydrate_gbnc_payload_from_series_ids(
        [int(series_id) for series_id in (pulled.get("series_ids") or []) if int(series_id) > 0],
        current_user=current_user,
        guest_key=guest_key,
    )
    hydrated["cache_hit"] = bool(pulled.get("cache_hit"))
    return hydrated


def _get_series_row(series_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      ts.id,
                      ts.owner_user_id,
                      ts.term_id,
                      ts.source_id,
                      ts.units,
                      lt.canonical,
                      ds.name AS source_name,
                      ts.granularity,
                      ts.window_start,
                      ts.window_end,
                      ts.meta_json,
                      JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')) AS task_id,
                      t.guest_key,
                      t.created_at AS task_created_at,
                      t.status AS task_status,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), lt.canonical) AS variant
                    FROM time_series ts
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    JOIN data_sources ds ON ds.id = ts.source_id
                    LEFT JOIN tasks t ON t.task_id = JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id'))
                    WHERE ts.id=:series_id
                    LIMIT 1
                    """
                ),
                {"series_id": series_id},
            )
            .mappings()
            .first()
        )


def _hydrate_gbnc_payload_from_series_ids(series_ids: list[int], current_user: dict | None = None, guest_key: str | None = None):
    rows: list[Any] = []
    for series_id in series_ids:
        row = _get_series_row(int(series_id))
        if not row:
            continue
        _ensure_series_access(row, current_user=current_user, guest_key=guest_key)
        rows.append(row)

    if not rows:
        return {
            "source": "GBNC",
            "corpus": None,
            "smoothing": None,
            "unit": "relative_frequency",
            "series": [],
            "warnings": [],
            "error_reason": None,
        }

    root_meta = _parse_meta(rows[0].get("meta_json"))
    warnings: list[str] = []
    series: list[dict[str, Any]] = []
    for row in rows:
        row_meta = _parse_meta(row.get("meta_json"))
        for warning in row_meta.get("warnings") or []:
            message = str(warning or "").strip()
            if message and message not in warnings:
                warnings.append(message)
        points = []
        for item in _series_points(int(row["id"])):
            try:
                year = int(str(item.get("time") or "")[:4])
            except Exception:
                continue
            points.append({"year": year, "value": float(item.get("value") or 0.0)})
        series.append(
            {
                "variant": str(row.get("variant") or row.get("canonical") or "").strip().lower(),
                "points": points,
            }
        )

    return {
        "source": rows[0].get("source_name"),
        "corpus": root_meta.get("corpus"),
        "smoothing": root_meta.get("smoothing"),
        "unit": rows[0].get("units") or "relative_frequency",
        "series": series,
        "warnings": warnings,
        "error_reason": root_meta.get("error_reason"),
    }


def _ensure_series_access(series_row, current_user: dict | None, guest_key: str | None = None):
    if not series_row:
        raise HTTPException(status_code=404, detail="series not found")
    if _is_admin(current_user):
        return
    owner_user_id = series_row.get("owner_user_id")
    uid = _owner_id(current_user)
    task_id = _normalize_task_id(series_row.get("task_id"))
    if owner_user_id is None and not task_id:
        return
    if uid is not None and owner_user_id == uid:
        return
    if uid is None and owner_user_id is None:
        safe_guest_key = _normalize_guest_key(guest_key)
        if (
            safe_guest_key
            and safe_guest_key == _normalize_guest_key(series_row.get("guest_key"))
            and _is_today_utc(series_row.get("task_created_at"))
            and str(series_row.get("task_status") or "").upper() != "DELETED"
        ):
            return
    raise HTTPException(status_code=403, detail="forbidden")


def get_gbnc_series_payload(series_id: int, current_user: dict | None = None, guest_key: str | None = None):
    row = _get_series_row(series_id)
    _ensure_series_access(row, current_user, guest_key=guest_key)
    meta = _parse_meta(row.get("meta_json"))
    task_id = _normalize_task_id(row.get("task_id"))
    owner_user_id = row.get("owner_user_id")

    with get_engine().begin() as conn:
        if task_id:
            siblings = (
                conn.execute(
                    text(
                        """
                        SELECT
                          ts.id,
                          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), lt.canonical) AS variant,
                          (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                        FROM time_series ts
                        JOIN lexicon_terms lt ON lt.id = ts.term_id
                        WHERE JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')) = :task_id
                          AND ts.term_id = :term_id
                          AND ts.source_id = :source_id
                          AND ts.granularity = :granularity
                          AND ts.window_start = :window_start
                          AND ts.window_end = :window_end
                        ORDER BY ts.id ASC
                        """
                    ),
                    {
                        "task_id": task_id,
                        "term_id": row["term_id"],
                        "source_id": row["source_id"],
                        "granularity": row["granularity"],
                        "window_start": row["window_start"],
                        "window_end": row["window_end"],
                    },
                )
                .mappings()
                .all()
            )
        else:
            siblings = (
                conn.execute(
                    text(
                        """
                        SELECT
                          ts.id,
                          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), lt.canonical) AS variant,
                          (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                        FROM time_series ts
                        JOIN lexicon_terms lt ON lt.id = ts.term_id
                        WHERE ts.term_id=:term_id
                          AND ts.source_id=:source_id
                          AND ts.granularity=:granularity
                          AND ts.window_start=:window_start
                          AND ts.window_end=:window_end
                          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')), '') = ''
                          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.corpus')), '') = :corpus
                          AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.smoothing')) AS SIGNED), -1) = :smoothing
                          AND (
                            (:owner_user_id IS NULL AND ts.owner_user_id IS NULL)
                            OR ts.owner_user_id = :owner_user_id
                          )
                        ORDER BY ts.id ASC
                        """
                    ),
                    {
                        "term_id": row["term_id"],
                        "source_id": row["source_id"],
                        "granularity": row["granularity"],
                        "window_start": row["window_start"],
                        "window_end": row["window_end"],
                        "corpus": str(meta.get("corpus") or ""),
                        "smoothing": int(meta.get("smoothing")) if meta.get("smoothing") is not None else -1,
                        "owner_user_id": owner_user_id,
                    },
                )
                .mappings()
                .all()
            )
    for sibling in siblings:
        sibling_row = _get_series_row(int(sibling["id"]))
        _ensure_series_access(sibling_row, current_user=current_user, guest_key=guest_key)
    point_count = int(sum(int(s.get("point_count") or 0) for s in siblings))
    return {
        "series_id": int(row["id"]),
        "source": row.get("source_name"),
        "word": row.get("canonical"),
        "granularity": row.get("granularity"),
        "window_start": str(row.get("window_start")),
        "window_end": str(row.get("window_end")),
        "variants": [str(s["variant"]) for s in siblings],
        "point_count": point_count,
        "items": [{"series_id": int(s["id"]), "variant": s["variant"], "point_count": int(s["point_count"])} for s in siblings],
        "meta": meta,
    }


def get_gbnc_series_points_payload(
    series_id: int,
    variant: str | None = None,
    current_user: dict | None = None,
    guest_key: str | None = None,
):
    info = get_gbnc_series_payload(series_id, current_user=current_user, guest_key=guest_key)
    target_variant = str(variant or "").strip().lower()
    target_series_id = series_id
    if target_variant:
        for item in info["items"]:
            if str(item["variant"]).strip().lower() == target_variant:
                target_series_id = int(item["series_id"])
                break
        else:
            raise HTTPException(status_code=404, detail="variant not found")
    points = _series_points(target_series_id)
    return {
        "series_id": int(target_series_id),
        "variant": target_variant or str(info.get("items", [{}])[0].get("variant", "")),
        "items": points,
    }
