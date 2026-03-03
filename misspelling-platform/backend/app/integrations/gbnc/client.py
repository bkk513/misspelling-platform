import os
import time

import requests

from .parser import parse_gbnc_json


def _build_terms(term: str, variants: list[str]) -> list[str]:
    terms: list[str] = []
    for raw in [term, *(variants or [])]:
        value = str(raw or "").strip().lower()
        if not value:
            continue
        if value not in terms:
            terms.append(value)
    return terms


def fetch_gbnc_series(
    term: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
):
    terms = _build_terms(term, variants)
    if not terms:
        return {
            "source": "GBNC",
            "corpus": corpus,
            "smoothing": int(smoothing),
            "unit": "relative_frequency",
            "series": [],
            "warnings": ["empty_terms"],
            "latency_ms": 0,
        }

    base_url = (os.getenv("GBNC_BASE_URL") or "https://books.google.com/ngrams/json").strip()
    timeout = float(os.getenv("GBNC_TIMEOUT_SECONDS", "10") or "10")
    retries = int(os.getenv("GBNC_RETRIES", "1") or "1")
    user_agent = (os.getenv("GBNC_USER_AGENT") or "misspelling-platform/1.0").strip()

    params = {
        "content": ",".join(terms),
        "year_start": int(start_year),
        "year_end": int(end_year),
        "corpus": corpus,
        "smoothing": int(smoothing),
    }
    headers = {"User-Agent": user_agent}

    errors: list[str] = []
    started = time.time()
    for _ in range(max(1, retries)):
        try:
            response = requests.get(base_url, params=params, headers=headers, timeout=timeout)
            if response.status_code in (429, 503):
                errors.append(f"http_{response.status_code}")
                continue
            response.raise_for_status()
            payload = response.json()
            for item in payload:
                if isinstance(item, dict):
                    item["year_start"] = int(start_year)
            parsed = parse_gbnc_json(payload, corpus=corpus, smoothing=int(smoothing))
            return {
                "source": parsed.source,
                "corpus": parsed.corpus,
                "smoothing": parsed.smoothing,
                "unit": parsed.unit,
                "series": [
                    {
                        "variant": v.variant,
                        "points": [{"year": p.year, "value": p.value} for p in v.points],
                    }
                    for v in parsed.series
                ],
                "warnings": parsed.warnings,
                "latency_ms": int((time.time() - started) * 1000),
            }
        except Exception as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors) if errors else "gbnc_request_failed")
