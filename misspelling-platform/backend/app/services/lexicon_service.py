import json
from typing import Any

from ..db.audit_logs_repo import insert_audit_log
from ..db.lexicon_repo import (
    find_term_by_word,
    get_or_create_term,
    get_term,
    list_terms,
    list_variants,
    upsert_variants,
)
from ..providers.llm_bailian import suggest_variants
from .dictionary_service import enrich_term, search_terms


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def suggest_and_cache_variants(word: str, k: int = 12, current_user: dict | None = None):
    term = find_term_by_word(word)
    owner_user_id = _owner_id(current_user)
    if term:
        cached = list_variants(int(term["id"]), owner_user_id=owner_user_id, include_all=_is_admin(current_user))
        cached_values = [str(v["variant"]) for v in cached]
        if cached_values:
            return {
                "word": word,
                "variants": cached_values[:k],
                "source": "cache",
                "warnings": [],
                "llm_error": None,
                "term_id": int(term["id"]),
            }

    suggested = suggest_variants(word, k=k, actor_user_id=owner_user_id)
    term_id = term["id"] if term else get_or_create_term(word, owner_user_id=owner_user_id)
    upsert_variants(int(term_id), suggested["variants"], source=str(suggested["source"]), owner_user_id=owner_user_id)
    insert_audit_log(
        action="LEXICON_VARIANT_SUGGEST",
        actor_user_id=owner_user_id,
        target_type="term",
        target_id=str(term_id),
        meta={
            "word": word,
            "variants_count": len(suggested["variants"]),
            "source": suggested["source"],
            "warnings": suggested.get("warnings") or [],
        },
    )
    return {
        "word": word,
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
    variants = list_variants(term_id, owner_user_id=_owner_id(current_user), include_all=_is_admin(current_user))
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
