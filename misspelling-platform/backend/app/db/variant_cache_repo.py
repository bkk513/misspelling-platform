"""文件说明：变体cache数据访问模块，负责对应表或实体的查询与写入。"""

import json

from sqlalchemy import bindparam, text

from .core import get_engine


def upsert_variants(owner_user_id: int, word: str, variants: list[str], source: str) -> int:
    count = 0
    normalized_word = str(word or "").strip().lower()
    if owner_user_id <= 0 or not normalized_word:
        return 0
    with get_engine().begin() as conn:
        for variant in variants:
            v = str(variant or "").strip().lower()
            if not v:
                continue
            conn.execute(
                text(
                    """
                    INSERT INTO variant_cache_entries (owner_user_id, word, variant, source, meta_json)
                    VALUES (:owner_user_id, :word, :variant, :source, :meta_json)
                    ON DUPLICATE KEY UPDATE
                      source=VALUES(source),
                      updated_at=CURRENT_TIMESTAMP
                    """
                ),
                {
                    "owner_user_id": owner_user_id,
                    "word": normalized_word,
                    "variant": v,
                    "source": source,
                    "meta_json": json.dumps({"source": source}),
                },
            )
            count += 1
    return count


def list_variants(
    owner_user_id: int,
    word: str | None = None,
    limit: int = 200,
):
    if owner_user_id <= 0:
        return []
    where = "owner_user_id = :owner_user_id"
    params: dict[str, object] = {"owner_user_id": owner_user_id, "limit": max(1, min(int(limit), 1000))}
    if word:
        where += " AND word = :word"
        params["word"] = str(word).strip().lower()
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT id, owner_user_id, word, variant, source, created_at, updated_at
                    FROM variant_cache_entries
                    WHERE {where}
                    ORDER BY updated_at DESC, id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )


def delete_variants(
    owner_user_id: int,
    ids: list[int] | None = None,
    word: str | None = None,
    variants: list[str] | None = None,
) -> int:
    if owner_user_id <= 0:
        return 0
    safe_ids: list[int] = []
    for value in ids or []:
        try:
            parsed = int(value)
        except Exception:
            continue
        if parsed > 0:
            safe_ids.append(parsed)
    ids = safe_ids
    normalized_word = str(word or "").strip().lower() or None
    normalized_variants = [str(v).strip().lower() for v in (variants or []) if str(v).strip()]

    where = ["owner_user_id = :owner_user_id"]
    params: dict[str, object] = {"owner_user_id": owner_user_id}

    if ids:
        where.append("id IN :ids")
        params["ids"] = ids
    if normalized_word:
        where.append("word = :word")
        params["word"] = normalized_word
    if normalized_variants:
        where.append("variant IN :variants")
        params["variants"] = normalized_variants

    if len(where) == 1:
        return 0

    sql = text(f"DELETE FROM variant_cache_entries WHERE {' AND '.join(where)}")
    if ids:
        sql = sql.bindparams(bindparam("ids", expanding=True))
    if normalized_variants:
        sql = sql.bindparams(bindparam("variants", expanding=True))
    with get_engine().begin() as conn:
        result = conn.execute(sql, params)
        return int(result.rowcount or 0)


def admin_list_variants(
    owner_user_id: int | None = None,
    word: str | None = None,
    limit: int = 300,
):
    where = ["1=1"]
    params: dict[str, object] = {"limit": max(1, min(int(limit), 2000))}
    if owner_user_id is not None and owner_user_id > 0:
        where.append("v.owner_user_id = :owner_user_id")
        params["owner_user_id"] = owner_user_id
    if word:
        where.append("v.word = :word")
        params["word"] = str(word).strip().lower()
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    f"""
                    SELECT
                      v.id,
                      v.owner_user_id,
                      u.username,
                      v.word,
                      v.variant,
                      v.source,
                      v.created_at,
                      v.updated_at
                    FROM variant_cache_entries v
                    JOIN users u ON u.id = v.owner_user_id
                    WHERE {' AND '.join(where)}
                    ORDER BY v.updated_at DESC, v.id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )


def admin_delete_variant(entry_id: int) -> int:
    if entry_id <= 0:
        return 0
    with get_engine().begin() as conn:
        result = conn.execute(
            text("DELETE FROM variant_cache_entries WHERE id=:entry_id"),
            {"entry_id": entry_id},
        )
        return int(result.rowcount or 0)
