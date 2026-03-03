import csv
from pathlib import Path
from threading import Lock

_SEED_PATH = Path(__file__).resolve().parent.parent / "assets" / "word_attributes_seed.csv"
_CACHE: list[dict] | None = None
_LOCK = Lock()


def _load_seed() -> list[dict]:
    rows: list[dict] = []
    if not _SEED_PATH.exists():
        return rows
    with _SEED_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                {
                    "lemma": (row.get("lemma") or "").strip().lower(),
                    "pos": row.get("pos"),
                    "syllables": int(row.get("syllables") or 0),
                    "length": int(row.get("length") or 0),
                    "is_proper": bool(int(row.get("is_proper") or 0)),
                    "frequency_proxy": float(row.get("frequency_proxy") or 0),
                    "source": row.get("source") or "seed",
                }
            )
    return rows


def _seed_rows() -> list[dict]:
    global _CACHE
    if _CACHE is None:
        with _LOCK:
            if _CACHE is None:
                _CACHE = _load_seed()
    return _CACHE or []


def enrich_term(word: str):
    target = str(word or "").strip().lower()
    if not target:
        return None
    for row in _seed_rows():
        if row["lemma"] == target:
            return row
    return {
        "lemma": target,
        "pos": "unknown",
        "syllables": max(1, len(target) // 3),
        "length": len(target),
        "is_proper": bool(target[:1].isupper()),
        "frequency_proxy": 0.1,
        "source": "derived",
    }


def search_terms(q: str = "", limit: int = 50):
    query = str(q or "").strip().lower()
    out = []
    for row in _seed_rows():
        if query and query not in row["lemma"]:
            continue
        out.append(row)
        if len(out) >= max(1, min(int(limit), 500)):
            break
    return out
