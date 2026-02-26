import os
import re
from typing import Any

from ..db.lexicon_repo import bump_version, get_or_create_term, list_terms, list_variants, upsert_variants
from ..providers.llm_bailian import suggest_variants
from .audit_log_service import record_audit


def normalize_word(word: str) -> str:
    s = (word or "").strip().lower().replace("_", "-")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*-\s*", "-", s)
    return s


def _heuristic_variants(word: str, k: int) -> list[str]:
    if not word:
        return []
    cands = [
        word + word[-1],
        (word[:-1] if len(word) > 2 else word),
        (word[:1] + "-" + word[1:] if len(word) > 3 else word + "-"),
        (word[:-2] + word[-1] + word[-2] if len(word) > 3 else word[::-1]),
        (word.replace("e", "", 1) if "e" in word else word + "e"),
        (word.replace("i", "ie", 1) if "i" in word else word),
    ]
    out: list[str] = []
    seen = {word}
    for c in cands:
        n = normalize_word(c)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
        if len(out) >= k:
            break
    return out


def get_or_suggest_variants(word: str, k: int = 20) -> dict[str, Any]:
    canonical = normalize_word(word)
    if not canonical:
        return {"word": "", "variants": [], "source": "cache", "version_id": None, "llm_enabled": bool(os.getenv("BAILIAN_API_KEY"))}
    term_id = get_or_create_term(canonical)
    term, cached_rows = list_variants(term_id)
    if cached_rows:
        return {
            "word": canonical,
            "term_id": term_id,
            "variants": [str(r["variant"]) for r in cached_rows][: max(1, min(int(k), 50))],
            "source": "cache",
            "version_id": next((r["version_id"] for r in cached_rows if r["version_id"] is not None), None),
            "llm_enabled": bool(os.getenv("BAILIAN_API_KEY", "").strip()),
        }
    llm_enabled = bool(os.getenv("BAILIAN_API_KEY", "").strip())
    variants = suggest_variants(canonical, k=max(1, min(int(k), 50)))
    warning = None
    source_tag = "llm"
    if not variants:
        variants = _heuristic_variants(canonical, k=max(1, min(int(k), 50)))
        if not llm_enabled:
            warning = "llm disabled; using heuristic fallback"
            record_audit("LLM_DISABLED", "llm_bailian", canonical, {"word": canonical, "level": "WARN", "message": warning})
        else:
            warning = "llm returned empty; using heuristic fallback"
            record_audit("LLM_EMPTY", "llm_bailian", canonical, {"word": canonical, "level": "WARN", "message": warning})
    version_id = bump_version(f"M7 variants for {canonical}") if variants else None
    if variants:
        upsert_variants(term_id, variants, source="llm" if llm_enabled else "heuristic", version_id=version_id)
        record_audit("LEXICON_VARIANTS_UPSERT", "lexicon_term", str(term_id), {"word": canonical, "count": len(variants), "source": source_tag})
    return {
        "word": canonical,
        "term_id": term_id,
        "variants": variants,
        "source": source_tag,
        "version_id": version_id,
        "llm_enabled": llm_enabled,
        "warning": warning,
        "term": dict(term) if term else None,
    }


def list_terms_payload(limit: int = 20) -> dict[str, Any]:
    rows = list_terms(max(1, min(int(limit), 200)))
    return {"items": [dict(r) for r in rows]}


def list_term_variants_payload(term_id: int) -> dict[str, Any]:
    term, rows = list_variants(int(term_id))
    return {
        "term": dict(term) if term else None,
        "items": [
            {
                **dict(r),
            }
            for r in rows
        ],
    }


def admin_add_variants_payload(
    *,
    term_id: int | None,
    word: str | None,
    variants: list[str],
    actor: str = "admin",
) -> dict[str, Any]:
    normalized_variants = []
    seen = set()
    for item in variants:
        norm = normalize_word(str(item))
        if norm and norm not in seen:
            seen.add(norm)
            normalized_variants.append(norm)
    canonical = normalize_word(word or "")
    if term_id is None:
        term_id = get_or_create_term(canonical or (normalized_variants[0] if normalized_variants else ""))
    version_id = bump_version(f"M7 admin variants update term_id={term_id}") if normalized_variants else None
    inserted = upsert_variants(int(term_id), normalized_variants, source="admin", version_id=version_id, variant_type="manual")
    record_audit(
        "ADMIN_LEXICON_VARIANTS_UPSERT",
        "lexicon_term",
        str(term_id),
        {"actor": actor, "count": inserted, "variants": normalized_variants[:20]},
    )
    return {
        "ok": True,
        "term_id": int(term_id),
        "version_id": version_id,
        "count": inserted,
        "variants": normalized_variants,
    }
