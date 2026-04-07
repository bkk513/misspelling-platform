"""文件说明：词库数据访问模块，负责对应表或实体的查询与写入。"""

import json

from sqlalchemy import text

from .core import get_engine


def _where_scope(owner_user_id: int | None, include_all: bool):
    if include_all:
        return "1=1", {}
    if owner_user_id is None:
        return "(owner_user_id IS NULL)", {}
    return "(owner_user_id IS NULL OR owner_user_id=:owner_user_id)", {"owner_user_id": owner_user_id}


def get_or_create_term(canonical: str, owner_user_id: int | None = None, category: str | None = None):
    canonical = str(canonical or "").strip().lower()
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO lexicon_terms (canonical, category, language, meta_json, owner_user_id)
                VALUES (:canonical, :category, 'en', :meta_json, :owner_user_id)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), updated_at=CURRENT_TIMESTAMP
                """
            ),
            {
                "canonical": canonical,
                "category": category,
                "meta_json": json.dumps({"source": "lexicon"}),
                "owner_user_id": owner_user_id,
            },
        )
        term_id = int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())
    return term_id


def get_term(term_id: int, owner_user_id: int | None = None, include_all: bool = False):
    where, params = _where_scope(owner_user_id, include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, canonical, category, language, meta_json, owner_user_id, created_at, updated_at
                    FROM lexicon_terms
                    WHERE id=:term_id AND ({where})
                    LIMIT 1
                    """
                ),
                {"term_id": term_id, **params},
            )
            .mappings()
            .first()
        )


def list_terms(limit: int = 50, q: str = "", owner_user_id: int | None = None, include_all: bool = False):
    where, params = _where_scope(owner_user_id, include_all)
    if q:
        where = f"({where}) AND canonical LIKE :q"
        params["q"] = f"%{q.strip().lower()}%"
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, canonical, category, language, owner_user_id, created_at, updated_at
                    FROM lexicon_terms
                    WHERE {where}
                    ORDER BY updated_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": max(1, min(int(limit), 200)), **params},
            )
            .mappings()
            .all()
        )


def list_variants(term_id: int, owner_user_id: int | None = None, include_all: bool = False):
    where, params = _where_scope(owner_user_id, include_all)
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, term_id, variant, variant_type, source, owner_user_id, created_at
                    FROM lexicon_variants
                    WHERE term_id=:term_id AND ({where})
                    ORDER BY id ASC
                    """
                ),
                {"term_id": term_id, **params},
            )
            .mappings()
            .all()
        )


def upsert_variants(term_id: int, variants: list[str], source: str, owner_user_id: int | None = None):
    count = 0
    with get_engine().begin() as conn:
        for variant in variants:
            v = str(variant or "").strip().lower()
            if not v:
                continue
            conn.execute(
                text(
                    """
                    INSERT INTO lexicon_variants (term_id, variant, variant_type, source, owner_user_id, meta_json)
                    VALUES (:term_id, :variant, 'generated', :source, :owner_user_id, :meta_json)
                    ON DUPLICATE KEY UPDATE source=VALUES(source), owner_user_id=VALUES(owner_user_id)
                    """
                ),
                {
                    "term_id": term_id,
                    "variant": v,
                    "source": source,
                    "owner_user_id": owner_user_id,
                    "meta_json": json.dumps({"source": source}),
                },
            )
            count += 1
    return count


def find_term_by_word(word: str):
    target = str(word or "").strip().lower()
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, canonical, category, language, owner_user_id
                    FROM lexicon_terms
                    WHERE canonical=:canonical
                    LIMIT 1
                    """
                ),
                {"canonical": target},
            )
            .mappings()
            .first()
        )
