import json
from datetime import date

from sqlalchemy import text

from .core import get_engine


def ensure_term(canonical: str, category: str = "custom", language: str = "en") -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_terms (canonical, category, language, meta_json)
                VALUES (:canonical, :category, :language, :meta_json)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), updated_at=CURRENT_TIMESTAMP
                """
            ),
            {
                "canonical": canonical[:255],
                "category": category,
                "language": language,
                "meta_json": json.dumps({"stub": True}),
            },
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def ensure_variant(term_id: int, variant: str, variant_type: str = "generated") -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_variants (term_id, variant, variant_type, source, meta_json)
                VALUES (:term_id, :variant, :variant_type, 'stub', :meta_json)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
                """
            ),
            {
                "term_id": term_id,
                "variant": variant[:255],
                "variant_type": variant_type,
                "meta_json": json.dumps({"stub": True}),
            },
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def create_series(
    term_id: int,
    variant_id,
    source_id: int,
    granularity: str,
    window_start: date,
    window_end: date,
    units: str,
    meta: dict,
) -> int:
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO time_series (
                  term_id, variant_id, source_id, granularity, window_start, window_end, units, meta_json
                ) VALUES (
                  :term_id, :variant_id, :source_id, :granularity, :window_start, :window_end, :units, :meta_json
                )
                """
            ),
            {
                "term_id": term_id,
                "variant_id": variant_id,
                "source_id": source_id,
                "granularity": granularity,
                "window_start": window_start,
                "window_end": window_end,
                "units": units,
                "meta_json": json.dumps(meta),
            },
        )
        return int(result.lastrowid)


def insert_series_points(series_id: int, points):
    if not points:
        return
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO time_series_points (series_id, t, value)
                VALUES (:series_id, :t, :value)
                """
            ),
            [{"series_id": series_id, "t": p["t"], "value": p["value"]} for p in points],
        )


def list_series_by_task(task_id: str):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      ts.id AS series_id,
                      ds.name AS source_name,
                      lt.canonical,
                      ts.granularity,
                      ts.window_start,
                      ts.window_end,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'correct') AS variant,
                      (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                    FROM time_series ts
                    JOIN data_sources ds ON ds.id = ts.source_id
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    WHERE JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')) = :task_id
                    ORDER BY ts.id
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .all()
        )


def get_series_points_for_task(task_id: str, variant: str = "correct"):
    with get_engine().begin() as conn:
        series = (
            conn.execute(
                text(
                    """
                    SELECT id
                    FROM time_series
                    WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')) = :task_id
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.variant')), 'correct') = :variant
                    ORDER BY id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id, "variant": variant},
            )
            .mappings()
            .first()
        )
        if not series:
            return None, []
        rows = (
            conn.execute(
                text("SELECT t, value FROM time_series_points WHERE series_id = :series_id ORDER BY t"),
                {"series_id": series["id"]},
            )
            .mappings()
            .all()
        )
        return int(series["id"]), rows


def find_series_by_cache_key(cache_key: str):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      ts.id AS series_id,
                      lt.canonical,
                      COALESCE(lv.variant, JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'correct') AS variant,
                      ts.granularity,
                      ds.name AS source_name,
                      ts.window_start,
                      ts.window_end,
                      ts.units,
                      ts.meta_json,
                      (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                    FROM time_series ts
                    JOIN data_sources ds ON ds.id = ts.source_id
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    LEFT JOIN lexicon_variants lv ON lv.id = ts.variant_id
                    WHERE JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.gbnc_cache_key')) = :cache_key
                    ORDER BY ts.id
                    """
                ),
                {"cache_key": cache_key},
            )
            .mappings()
            .all()
        )


def get_series_with_points(series_id: int):
    with get_engine().begin() as conn:
        meta = (
            conn.execute(
                text(
                    """
                    SELECT
                      ts.id AS series_id,
                      ds.name AS source_name,
                      lt.canonical,
                      ts.granularity,
                      ts.window_start,
                      ts.window_end,
                      ts.units,
                      ts.meta_json,
                      COALESCE(lv.variant, JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'correct') AS variant
                    FROM time_series ts
                    JOIN data_sources ds ON ds.id = ts.source_id
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    LEFT JOIN lexicon_variants lv ON lv.id = ts.variant_id
                    WHERE ts.id = :series_id
                    """
                ),
                {"series_id": series_id},
            )
            .mappings()
            .first()
        )
        points = (
            conn.execute(
                text("SELECT t, value FROM time_series_points WHERE series_id = :series_id ORDER BY t"),
                {"series_id": series_id},
            )
            .mappings()
            .all()
        )
        return meta, points


def list_gbnc_series(limit: int = 100):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      ts.id AS series_id, lt.canonical, COALESCE(lv.variant, JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'correct') AS variant,
                      ds.name AS source_name, ts.granularity, ts.updated_at,
                      JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.corpus')) AS corpus,
                      JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.smoothing')) AS smoothing,
                      (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                    FROM time_series ts
                    JOIN data_sources ds ON ds.id = ts.source_id
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    LEFT JOIN lexicon_variants lv ON lv.id = ts.variant_id
                    WHERE ds.name = 'gbnc'
                    ORDER BY ts.updated_at DESC, ts.id DESC
                    LIMIT :n
                    """
                ),
                {"n": max(1, min(int(limit), 500))},
            )
            .mappings()
            .all()
        )
