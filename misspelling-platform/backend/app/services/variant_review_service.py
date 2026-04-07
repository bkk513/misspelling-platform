from __future__ import annotations

import re
from threading import Lock
from typing import Any

try:
    from spellchecker import SpellChecker
except Exception:  # pragma: no cover - dependency availability is environment-specific
    SpellChecker = None

_LOCK = Lock()
_SPELLCHECKER: Any | None = None
_WORD_SPLIT_RE = re.compile(r"[-']")


def _levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    prev = list(range(len(right) + 1))
    for i, left_ch in enumerate(left, start=1):
        curr = [i]
        for j, right_ch in enumerate(right, start=1):
            insert_cost = curr[j - 1] + 1
            delete_cost = prev[j] + 1
            replace_cost = prev[j - 1] + (0 if left_ch == right_ch else 1)
            curr.append(min(insert_cost, delete_cost, replace_cost))
        prev = curr
    return int(prev[-1])


def normalize_variant_token(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _checker() -> Any | None:
    global _SPELLCHECKER
    if SpellChecker is None:
        return None
    if _SPELLCHECKER is None:
        with _LOCK:
            if _SPELLCHECKER is None:
                _SPELLCHECKER = SpellChecker(language="en")
    return _SPELLCHECKER


def _dictionary_backend() -> str | None:
    return "pyspellchecker_en" if _checker() is not None else None


def _token_parts(token: str) -> list[str]:
    return [part for part in _WORD_SPLIT_RE.split(token) if part]


def _collapsed_token(token: str) -> str:
    return "".join(_token_parts(normalize_variant_token(token)))


def _max_typo_distance(token: str) -> int:
    length = len(_collapsed_token(token))
    if length <= 5:
        return 1
    if length <= 10:
        return 2
    if length <= 15:
        return 3
    return 4


def is_dictionary_word(token: str) -> bool | None:
    normalized = normalize_variant_token(token)
    if not normalized:
        return False
    checker = _checker()
    if checker is None:
        return None
    parts = _token_parts(normalized)
    if not parts:
        return False
    if not all(part.isalpha() for part in parts):
        return False
    return all(bool(checker.known([part])) for part in parts)


def is_plausible_misspelling(word: str, variant: str) -> bool:
    canonical = _collapsed_token(word)
    candidate = _collapsed_token(variant)
    if not canonical or not candidate:
        return False
    if canonical == candidate:
        return True
    edit_distance = _levenshtein_distance(canonical, candidate)
    if edit_distance > _max_typo_distance(canonical):
        return False
    if canonical[:1] != candidate[:1] and edit_distance > 1:
        return False
    if abs(len(canonical) - len(candidate)) > max(1, _max_typo_distance(canonical)):
        return False
    return True


def review_misspelling_variants(word: str, variants: list[str] | None) -> dict[str, Any]:
    canonical = normalize_variant_token(word)
    accepted: list[str] = []
    rejected: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[str] = set()
    backend = _dictionary_backend()
    if backend is None:
        warnings.append("variant_dictionary_checker_unavailable")

    for raw in variants or []:
        candidate = normalize_variant_token(raw)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if candidate == canonical:
            rejected.append(
                {
                    "variant": candidate,
                    "reason": "canonical_word",
                    "reason_label": "Same as canonical word",
                    "dictionary_backend": backend,
                }
            )
            continue
        lexical = is_dictionary_word(candidate)
        if lexical is True:
            rejected.append(
                {
                    "variant": candidate,
                    "reason": "dictionary_word",
                    "reason_label": "Known dictionary word",
                    "dictionary_backend": backend,
                }
            )
            continue
        if not is_plausible_misspelling(canonical, candidate):
            rejected.append(
                {
                    "variant": candidate,
                    "reason": "implausible_for_canonical",
                    "reason_label": "Not a plausible misspelling of the canonical word",
                    "dictionary_backend": backend,
                }
            )
            continue
        accepted.append(candidate)

    if rejected:
        warnings.append("variant_filter_removed_nonword_or_implausible_variants")

    return {
        "word": canonical,
        "variants": accepted,
        "accepted_variants": accepted,
        "accepted_count": len(accepted),
        "rejected_variants": rejected,
        "rejected_count": len(rejected),
        "filter_policy": "nonword_typo_like_only",
        "dictionary_backend": backend,
        "warnings": warnings,
    }
