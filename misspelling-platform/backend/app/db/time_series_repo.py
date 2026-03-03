import json
from datetime import date

from sqlalchemy import bindparam, text

from .core import get_engine


def ensure_term(
    canonical: str,
    category: str = "custom",
    language: str = "en",
    owner_user_id: int | None = None,
) -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_terms (canonical, category, language, meta_json, owner_user_id)
                VALUES (:canonical, :category, :language, :meta_json, :owner_user_id)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), updated_at=CURRENT_TIMESTAMP
                """
            ),
            {
                "canonical": canonical[:255],
                "category": category,
                "language": language,
                "meta_json": json.dumps({"stub": True}),
                "owner_user_id": owner_user_id,
            },
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def ensure_variant(term_id: int, variant: str, variant_type: str = "generated", owner_user_id: int | None = None) -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_variants (term_id, variant, variant_type, source, meta_json, owner_user_id)
                VALUES (:term_id, :variant, :variant_type, 'stub', :meta_json, :owner_user_id)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
                """
            ),
            {
                "term_id": term_id,
                "variant": variant[:255],
                "variant_type": variant_type,
                "meta_json": json.dumps({"stub": True}),
                "owner_user_id": owner_user_id,
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
    owner_user_id: int | None = None,
) -> int:
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO time_series (
                  term_id, variant_id, source_id, granularity, window_start, window_end, units, meta_json, owner_user_id
                ) VALUES (
                  :term_id, :variant_id, :source_id, :granularity, :window_start, :window_end, :units, :meta_json, :owner_user_id
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
                "owner_user_id": owner_user_id,
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


def list_series_by_task(task_id: str, owner_user_id: int | None = None, include_all: bool = False):
    owner_where = ""
    params = {"task_id": task_id}
    if not include_all:
        if owner_user_id is None:
            owner_where = " AND ts.owner_user_id IS NULL"
        else:
            owner_where = " AND ts.owner_user_id = :owner_user_id"
            params["owner_user_id"] = owner_user_id
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
                    """
                    + owner_where
                    + """
                    ORDER BY ts.id
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )


def get_series_points_for_task(
    task_id: str,
    variant: str = "correct",
    owner_user_id: int | None = None,
    include_all: bool = False,
):
    owner_where = ""
    params = {"task_id": task_id, "variant": variant}
    if not include_all:
        if owner_user_id is None:
            owner_where = " AND owner_user_id IS NULL"
        else:
            owner_where = " AND owner_user_id = :owner_user_id"
            params["owner_user_id"] = owner_user_id
    with get_engine().begin() as conn:
        series = (
            conn.execute(
                text(
                    """
                    SELECT id
                    FROM time_series
                    WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')) = :task_id
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.variant')), 'correct') = :variant
                    """
                    + owner_where
                    + """
                    ORDER BY id
                    LIMIT 1
                    """
                ),
                params,
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


def list_series(limit: int = 100, owner_user_id: int | None = None, include_all: bool = False):
    owner_where = ""
    params = {"limit": limit}
    if not include_all:
        if owner_user_id is None:
            owner_where = "WHERE ts.owner_user_id IS NULL"
        else:
            owner_where = "WHERE ts.owner_user_id = :owner_user_id"
            params["owner_user_id"] = owner_user_id
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
                      ts.owner_user_id,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')), '') AS task_id,
                      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'correct') AS variant,
                      (SELECT COUNT(*) FROM time_series_points p WHERE p.series_id = ts.id) AS point_count
                    FROM time_series ts
                    JOIN data_sources ds ON ds.id = ts.source_id
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    """
                    + owner_where
                    + """
                    ORDER BY ts.id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )


def list_series_owners(series_ids: list[int]):
    if not series_ids:
        return []
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, owner_user_id
                    FROM time_series
                    WHERE id IN :ids
                    """
                ).bindparams(bindparam("ids", expanding=True)),
                {"ids": series_ids},
            )
            .mappings()
            .all()
        )


def delete_series_by_ids(series_ids: list[int]) -> int:
    if not series_ids:
        return 0
    with get_engine().begin() as conn:
        result = conn.execute(
            text("DELETE FROM time_series WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)),
            {"ids": series_ids},
        )
        return int(result.rowcount or 0)
