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
