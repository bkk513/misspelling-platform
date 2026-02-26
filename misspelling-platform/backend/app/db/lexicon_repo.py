import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import text

from .core import get_engine


def get_or_create_term(canonical: str, category: str = "custom", language: str = "en") -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_terms (canonical, category, language, meta_json)
                VALUES (:canonical, :category, :language, :meta_json)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), updated_at=CURRENT_TIMESTAMP
                """
            ),
            {"canonical": canonical[:255], "category": category, "language": language, "meta_json": json.dumps({"m7": True})},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def list_terms(limit: int = 20):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, canonical, category, language, created_at, updated_at
                    FROM lexicon_terms
                    ORDER BY updated_at DESC, id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            .mappings()
            .all()
        )


def list_variants(term_id: int):
    with get_engine().begin() as conn:
        term = (
            conn.execute(
                text("SELECT id, canonical, category, language FROM lexicon_terms WHERE id=:term_id"),
                {"term_id": term_id},
            )
            .mappings()
            .first()
        )
        variants = (
            conn.execute(
                text(
                    """
                    SELECT id, term_id, variant, variant_type, source, version_id, meta_json, created_at
                    FROM lexicon_variants
                    WHERE term_id=:term_id
                    ORDER BY id ASC
                    """
                ),
                {"term_id": term_id},
            )
            .mappings()
            .all()
        )
        return term, variants


def bump_version(note: str | None = None) -> int:
    name = f"m7-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6]}"
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE lexicon_versions SET is_active=0 WHERE is_active=1"))
        conn.execute(
            text("INSERT INTO lexicon_versions (name, note, is_active) VALUES (:name, :note, 1)"),
            {"name": name, "note": (note or "M7 lexicon update")[:255]},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def upsert_variants(term_id: int, variants: list[str], source: str, version_id: int | None, variant_type: str = "generated") -> int:
    if not variants:
        return 0
    rows = []
    for item in variants:
        rows.append(
            {
                "term_id": term_id,
                "variant": item[:255],
                "variant_type": variant_type[:32],
                "source": source[:64],
                "version_id": version_id,
                "meta_json": json.dumps({"m7": True}),
            }
        )
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_variants (term_id, variant, variant_type, source, version_id, meta_json)
                VALUES (:term_id, :variant, :variant_type, :source, :version_id, :meta_json)
                ON DUPLICATE KEY UPDATE
                  source=VALUES(source),
                  version_id=VALUES(version_id),
                  meta_json=VALUES(meta_json)
                """
            ),
            rows,
        )
    return len(rows)
