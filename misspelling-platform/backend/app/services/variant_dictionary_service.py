"""文件说明：变体词典服务模块，负责读取本地词典与为变体建议提供基础词典能力。"""

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

_DICT_FILENAME = "adversarial_advs_clean_cleaned_completion2.0.json"
_CACHE: dict[str, list[str]] | None = None
_DICT_PATH: str | None = None
_LOCK = Lock()


def _normalize_token(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _candidate_paths() -> list[Path]:
    out: list[Path] = []
    env_path = str(os.getenv("MISSPELL_VARIANT_DICT_PATH") or "").strip()
    if env_path:
        out.append(Path(env_path))

    here = Path(__file__).resolve()
    for idx in (3, 4):
        try:
            out.append(here.parents[idx] / _DICT_FILENAME)
        except IndexError:
            continue

    cwd = Path.cwd()
    out.append(cwd / _DICT_FILENAME)
    out.append(cwd.parent / _DICT_FILENAME)
    return out


def _load_dictionary() -> tuple[dict[str, list[str]], str | None]:
    for candidate in _candidate_paths():
        if not candidate.exists() or not candidate.is_file():
            continue
        try:
            raw = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue

        normalized: dict[str, list[str]] = {}
        for key, values in raw.items():
            canonical = _normalize_token(str(key))
            if not canonical or not isinstance(values, list):
                continue
            variants: list[str] = []
            for value in values:
                item = _normalize_token(str(value))
                if not item or item == canonical or item in variants:
                    continue
                variants.append(item)
            if variants:
                normalized[canonical] = variants
        return normalized, str(candidate)
    return {}, None


def _dictionary_cache() -> tuple[dict[str, list[str]], str | None]:
    global _CACHE
    global _DICT_PATH
    if _CACHE is None:
        with _LOCK:
            if _CACHE is None:
                _CACHE, _DICT_PATH = _load_dictionary()
    return _CACHE or {}, _DICT_PATH


def suggest_from_dictionary(word: str, k: int = 20) -> dict[str, Any]:
    target = _normalize_token(word)
    if not target:
        return {"variants": [], "found": False, "dictionary_path": None}
    data, path = _dictionary_cache()
    variants = list(data.get(target) or [])[: max(1, min(int(k), 100))]
    return {
        "variants": variants,
        "found": bool(variants),
        "dictionary_path": path,
    }

