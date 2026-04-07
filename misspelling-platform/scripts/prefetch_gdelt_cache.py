#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
SAFE_NAME_RE = re.compile(r"[^a-z0-9]+")


def normalize_token(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def safe_name(value: str) -> str:
    safe = SAFE_NAME_RE.sub("_", normalize_token(value)).strip("_")
    return safe[:48] or "term"


def cache_file(cache_root: Path, variant: str, start_year: int, end_year: int) -> Path:
    import hashlib

    digest = hashlib.sha1(f"{variant}|{start_year}|{end_year}".encode("utf-8")).hexdigest()[:12]
    return cache_root / f"{safe_name(variant)}-{start_year}-{end_year}-{digest}.json"


def fetch_payload(variant: str, start_year: int, end_year: int) -> dict:
    resp = requests.get(
        GDELT_DOC_API,
        params={
            "query": variant,
            "mode": "TimelineVolRaw",
            "format": "json",
            "TIMELINESMOOTH": 0,
            "startdatetime": f"{int(start_year):04d}0101000000",
            "enddatetime": f"{int(end_year):04d}1231235959",
        },
        headers={"Accept": "application/json", "User-Agent": "misspelling-platform-prefetch/1.0"},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise RuntimeError("invalid gdelt payload")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Prefetch GDELT timeline payloads into the local cache.")
    parser.add_argument("word", help="canonical word")
    parser.add_argument("--variant", action="append", default=[], help="additional misspelling variant")
    parser.add_argument("--start-year", type=int, required=True)
    parser.add_argument("--end-year", type=int, required=True)
    parser.add_argument(
        "--cache-dir",
        default=str(Path(__file__).resolve().parents[1] / "runtime" / "gdelt_cache"),
        help="cache directory shared with the backend",
    )
    parser.add_argument("--sleep-seconds", type=float, default=2.2)
    args = parser.parse_args()

    cache_root = Path(args.cache_dir).expanduser()
    cache_root.mkdir(parents=True, exist_ok=True)

    terms = []
    for raw in [args.word, *(args.variant or [])]:
        token = normalize_token(raw)
        if token and token not in terms:
            terms.append(token)

    for index, term in enumerate(terms):
        payload = fetch_payload(term, args.start_year, args.end_year)
        path = cache_file(cache_root, term, args.start_year, args.end_year)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"cached {term} -> {path}")
        if index < len(terms) - 1 and args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
