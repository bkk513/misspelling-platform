from typing import Any

from ..db.audit_logs_repo import insert_audit_log
from ..db.lexicon_repo import (
    find_term_by_word,
    get_or_create_term,
    get_term,
    list_terms,
    list_variants as list_term_variants,
    upsert_variants as upsert_term_variants,
)
from ..db.variant_cache_repo import (
    admin_delete_variant as admin_delete_cached_variant,
    admin_list_variants as admin_list_cached_variants,
    delete_variants as delete_cached_variants,
    list_variants as list_cached_variants,
    upsert_variants as upsert_cached_variants,
)
from ..providers.llm_bailian import suggest_variants
from .dictionary_service import enrich_term, search_terms
from .variant_dictionary_service import suggest_from_dictionary


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_word(word: str) -> str:
    return str(word or "").strip().lower()


def suggest_and_cache_variants(word: str, k: int = 12, current_user: dict | None = None):
    normalized_word = _normalize_word(word)
    term = find_term_by_word(normalized_word)
    owner_user_id = _owner_id(current_user)

    dictionary_hit = suggest_from_dictionary(word=normalized_word, k=k)
    if dictionary_hit.get("found"):
        term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
        variants = [str(v) for v in (dictionary_hit.get("variants") or [])]
        if owner_user_id is not None:
            upsert_cached_variants(owner_user_id, normalized_word, variants, source="dictionary")
            upsert_term_variants(int(term_id), variants, source="dictionary", owner_user_id=owner_user_id)
        insert_audit_log(
            action="LEXICON_VARIANT_SUGGEST",
            actor_user_id=owner_user_id,
            target_type="term",
            target_id=str(term_id),
            meta={
                "word": normalized_word,
                "variants_count": len(variants),
                "source": "dictionary",
                "dictionary_path": dictionary_hit.get("dictionary_path"),
                "warnings": [],
            },
        )
        return {
            "word": normalized_word,
            "variants": variants,
            "source": "dictionary",
            "warnings": [],
            "llm_error": None,
            "term_id": int(term_id),
        }

    if owner_user_id is not None:
        cached = list_cached_variants(owner_user_id, word=normalized_word, limit=max(k, 200))
        cached_values = [str(v["variant"]) for v in cached]
        if cached_values:
            term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
            return {
                "word": normalized_word,
                "variants": cached_values[:k],
                "source": "cache",
                "warnings": [],
                "llm_error": None,
                "term_id": int(term_id),
            }

    suggested = suggest_variants(normalized_word, k=k, actor_user_id=owner_user_id)
    term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
    if owner_user_id is not None:
        upsert_cached_variants(owner_user_id, normalized_word, suggested["variants"], source=str(suggested["source"]))
        upsert_term_variants(
            int(term_id),
            suggested["variants"],
            source=str(suggested["source"]),
            owner_user_id=owner_user_id,
        )
    insert_audit_log(
        action="LEXICON_VARIANT_SUGGEST",
        actor_user_id=owner_user_id,
        target_type="term",
        target_id=str(term_id),
        meta={
            "word": normalized_word,
            "variants_count": len(suggested["variants"]),
            "source": suggested["source"],
            "warnings": suggested.get("warnings") or [],
        },
    )
    return {
        "word": normalized_word,
        "variants": suggested["variants"],
        "source": suggested["source"],
        "warnings": suggested.get("warnings") or [],
        "llm_error": suggested.get("llm_error"),
        "term_id": int(term_id),
    }


def list_terms_payload(limit: int = 50, q: str = "", current_user: dict | None = None):
    rows = list_terms(
        limit=limit,
        q=q,
        owner_user_id=_owner_id(current_user),
        include_all=_is_admin(current_user),
    )
    seed_hits = []
    if q:
        seed_hits = search_terms(q=q, limit=min(limit, 30))
    return {
        "items": [dict(r) for r in rows],
        "seed_hits": seed_hits,
    }


def get_term_payload(term_id: int, current_user: dict | None = None):
    term = get_term(term_id, owner_user_id=_owner_id(current_user), include_all=_is_admin(current_user))
    if not term:
        return {"id": term_id, "found": False}
    variants = list_term_variants(term_id, owner_user_id=_owner_id(current_user), include_all=_is_admin(current_user))
    attrs = enrich_term(str(term["canonical"]))
    return {
        "id": int(term["id"]),
        "canonical": term["canonical"],
        "category": term.get("category"),
        "language": term.get("language"),
        "owner_user_id": term.get("owner_user_id"),
        "attributes": attrs,
        "variants": [dict(v) for v in variants],
    }


def enrich_term_payload(word: str, current_user: dict | None = None):
    attrs = enrich_term(word)
    term_id = get_or_create_term(word, owner_user_id=_owner_id(current_user), category="custom")
    with_meta = {
        "term_id": term_id,
        "word": word,
        "attributes": attrs,
        "source": attrs.get("source") if isinstance(attrs, dict) else "derived",
    }
    insert_audit_log(
        action="TERM_ENRICH",
        actor_user_id=_owner_id(current_user),
        target_type="term",
        target_id=str(term_id),
        meta=with_meta,
    )
    return with_meta


def list_variant_cache_payload(current_user: dict, word: str = "", limit: int = 200):
    owner_user_id = _owner_id(current_user)
    rows = list_cached_variants(
        owner_user_id=owner_user_id or 0,
        word=_normalize_word(word) if word else None,
        limit=limit,
    )
    return {
        "items": [
            {
                "id": int(r["id"]),
                "owner_user_id": int(r["owner_user_id"]),
                "word": str(r["word"]),
                "variant": str(r["variant"]),
                "source": str(r["source"] or ""),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            }
            for r in rows
        ]
    }


def delete_variant_cache_payload(
    current_user: dict,
    ids: list[int] | None = None,
    word: str | None = None,
    variants: list[str] | None = None,
):
    owner_user_id = _owner_id(current_user)
    deleted = delete_cached_variants(
        owner_user_id=owner_user_id or 0,
        ids=ids,
        word=_normalize_word(word or "") or None,
        variants=[_normalize_word(v) for v in (variants or []) if _normalize_word(v)],
    )
    insert_audit_log(
        action="LEXICON_VARIANT_CACHE_DELETE",
        actor_user_id=owner_user_id,
        target_type="variant_cache",
        meta={
            "deleted": deleted,
            "ids_count": len(ids or []),
            "word": _normalize_word(word or "") or None,
            "variants_count": len(variants or []),
        },
    )
    return {"deleted": deleted}


def save_variant_cache_payload(
    current_user: dict,
    word: str,
    variants: list[str],
    source: str = "manual",
):
    owner_user_id = _owner_id(current_user)
    normalized_word = _normalize_word(word)
    cleaned = [_normalize_word(v) for v in variants if _normalize_word(v)]
    if not normalized_word or not cleaned:
        return {"saved": 0}
    saved = upsert_cached_variants(
        owner_user_id=owner_user_id or 0,
        word=normalized_word,
        variants=cleaned,
        source=source or "manual",
    )
    insert_audit_log(
        action="LEXICON_VARIANT_CACHE_SAVE",
        actor_user_id=owner_user_id,
        target_type="variant_cache",
        meta={
            "word": normalized_word,
            "saved": saved,
            "source": source or "manual",
        },
    )
    return {"saved": saved}


def admin_list_variant_cache_payload(limit: int = 300, user_id: int | None = None, word: str | None = None):
    rows = admin_list_cached_variants(
        owner_user_id=user_id if user_id and user_id > 0 else None,
        word=_normalize_word(word or "") or None,
        limit=limit,
    )
    return {
        "items": [
            {
                "id": int(r["id"]),
                "owner_user_id": int(r["owner_user_id"]),
                "username": str(r["username"]),
                "word": str(r["word"]),
                "variant": str(r["variant"]),
                "source": str(r["source"] or ""),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            }
            for r in rows
        ]
    }


def admin_delete_variant_cache_payload(entry_id: int, actor_user_id: int):
    deleted = admin_delete_cached_variant(entry_id)
    insert_audit_log(
        action="ADMIN_VARIANT_CACHE_DELETE",
        actor_user_id=actor_user_id,
        target_type="variant_cache",
        target_id=str(entry_id),
        meta={"deleted": deleted},
    )
    return {"deleted": deleted > 0}
