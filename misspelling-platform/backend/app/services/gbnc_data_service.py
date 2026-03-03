import json
from datetime import date, datetime, timezone

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
                "task_id": None,
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
                      lt.canonical,
                      ds.name AS source_name,
                      ts.granularity,
                      ts.window_start,
                      ts.window_end,
                      ts.meta_json,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), lt.canonical) AS variant
                    FROM time_series ts
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    JOIN data_sources ds ON ds.id = ts.source_id
                    WHERE ts.id=:series_id
                    LIMIT 1
                    """
                ),
                {"series_id": series_id},
            )
            .mappings()
            .first()
        )


def _ensure_series_access(series_row, current_user: dict | None):
    if not series_row:
        raise HTTPException(status_code=404, detail="series not found")
    if _is_admin(current_user):
        return
    owner_user_id = series_row.get("owner_user_id")
    uid = _owner_id(current_user)
    if uid is None and owner_user_id is None:
        return
    if uid is not None and owner_user_id == uid:
        return
    raise HTTPException(status_code=403, detail="forbidden")


def get_gbnc_series_payload(series_id: int, current_user: dict | None = None):
    row = _get_series_row(series_id)
    _ensure_series_access(row, current_user)
    meta = row.get("meta_json")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            pass

    with get_engine().begin() as conn:
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
                      AND ts.window_start=:window_start
                      AND ts.window_end=:window_end
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.corpus')), '')=
                          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(:meta_json, '$.corpus')), '')
                      AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.smoothing')) AS SIGNED), -1)=
                          COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(:meta_json, '$.smoothing')) AS SIGNED), -1)
                    ORDER BY ts.id ASC
                    """
                ),
                {
                    "term_id": row["term_id"],
                    "window_start": row["window_start"],
                    "window_end": row["window_end"],
                    "meta_json": json.dumps(meta or {}),
                },
            )
            .mappings()
            .all()
        )
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


def get_gbnc_series_points_payload(series_id: int, variant: str | None = None, current_user: dict | None = None):
    info = get_gbnc_series_payload(series_id, current_user=current_user)
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
