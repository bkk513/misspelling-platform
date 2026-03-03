import os
import re
import time
from typing import Any

import requests

from .parser import parse_gbnc_json

# Compatible with corpus mapping used by GoogleBooksNgram-Script/getNgrams.py
_CORPUS_IDS = {
    "eng_2009": 0,
    "eng_1m_2009": 1,
    "eng_fiction_2009": 4,
    "eng_us_2009": 5,
    "eng_gb_2009": 6,
    "fre_2009": 7,
    "ger_2009": 8,
    "heb_2009": 9,
    "spa_2009": 10,
    "chi_sim_2009": 11,
    "rus_2009": 12,
    "eng_2012": 15,
    "eng_fiction_2012": 16,
    "eng_us_2012": 17,
    "eng_gb_2012": 18,
    "fre_2012": 19,
    "ger_2012": 20,
    "spa_2012": 21,
    "ita_2012": 22,
    "chi_sim_2012": 23,
    "heb_2012": 24,
    "rus_2012": 25,
    "eng_2019": 26,
    "eng_fiction_2019": 27,
    "eng_us_2019": 28,
    "eng_gb_2019": 29,
    "fre_2019": 30,
    "ger_2019": 31,
    "spa_2019": 32,
    "ita_2019": 33,
    "chi_sim_2019": 34,
    "heb_2019": 35,
    "rus_2019": 36,
}


def _build_terms(term: str, variants: list[str]) -> list[str]:
    terms: list[str] = []
    for raw in [term, *(variants or [])]:
        value = str(raw or "").strip().lower()
        if not value:
            continue
        if value not in terms:
            terms.append(value)
    return terms


def _normalize_series_payload(payload: dict[str, Any]):
    parsed = parse_gbnc_json(payload.get("raw") or [], corpus=str(payload["corpus"]), smoothing=int(payload["smoothing"]))
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
        "warnings": parsed.warnings + (payload.get("warnings") or []),
    }


def _fetch_via_json_endpoint(
    terms: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    timeout: float,
    retries: int,
    headers: dict[str, str],
):
    base_url = (os.getenv("GBNC_BASE_URL") or "https://books.google.com/ngrams/json").strip()
    params = {
        "content": ",".join(terms),
        "year_start": int(start_year),
        "year_end": int(end_year),
        "corpus": corpus,
        "smoothing": int(smoothing),
    }
    errors: list[str] = []
    for _ in range(max(1, retries)):
        try:
            response = requests.get(base_url, params=params, headers=headers, timeout=timeout)
            if response.status_code in (429, 503):
                errors.append(f"http_{response.status_code}")
                continue
            response.raise_for_status()
            raw = response.json()
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        item["year_start"] = int(start_year)
                return {"raw": raw, "corpus": corpus, "smoothing": smoothing, "warnings": []}
            errors.append("json_endpoint_invalid_payload")
        except Exception as exc:
            errors.append(str(exc))
    return {"error": "; ".join(errors) if errors else "json_endpoint_failed"}


def _fetch_via_graph_scrape(
    terms: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    timeout: float,
    retries: int,
    headers: dict[str, str],
):
    corpus_id = _CORPUS_IDS.get(corpus)
    if corpus_id is None:
        return {"error": f"unsupported_corpus_for_graph_fallback:{corpus}"}

    graph_url = "https://books.google.com/ngrams/graph"
    params = {
        "content": ",".join(terms),
        "year_start": int(start_year),
        "year_end": int(end_year),
        "corpus": int(corpus_id),
        "smoothing": int(smoothing),
    }
    errors: list[str] = []
    term_pattern = re.compile(r'\{"ngram":\s*"(.*?)"')
    ts_pattern = re.compile(r'"timeseries":\s*\[(.*?)\]')
    for _ in range(max(1, retries)):
        try:
            response = requests.get(graph_url, params=params, headers=headers, timeout=timeout)
            if response.status_code in (429, 503):
                errors.append(f"http_{response.status_code}")
                continue
            response.raise_for_status()
            html = response.text
            found_terms = term_pattern.findall(html)
            found_ts = ts_pattern.findall(html)
            if not found_terms or not found_ts:
                errors.append("graph_scrape_no_timeseries")
                continue

            raw: list[dict[str, Any]] = []
            for idx in range(min(len(found_terms), len(found_ts))):
                series_values = []
                for token in found_ts[idx].split(","):
                    token = token.strip()
                    if not token:
                        continue
                    try:
                        series_values.append(float(token))
                    except Exception:
                        series_values.append(0.0)
                raw.append(
                    {
                        "ngram": found_terms[idx],
                        "timeseries": series_values,
                        "year_start": int(start_year),
                    }
                )
            return {
                "raw": raw,
                "corpus": corpus,
                "smoothing": smoothing,
                "warnings": ["gbnc_graph_scrape_fallback"],
            }
        except Exception as exc:
            errors.append(str(exc))
    return {"error": "; ".join(errors) if errors else "graph_scrape_failed"}


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

    timeout = float(os.getenv("GBNC_TIMEOUT_SECONDS", "10") or "10")
    retries = int(os.getenv("GBNC_RETRIES", "1") or "1")
    user_agent = (os.getenv("GBNC_USER_AGENT") or "misspelling-platform/1.0").strip()
    headers = {"User-Agent": user_agent}

    started = time.time()

    json_result = _fetch_via_json_endpoint(
        terms=terms,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        timeout=timeout,
        retries=retries,
        headers=headers,
    )
    if "raw" in json_result:
        normalized = _normalize_series_payload(json_result)
        normalized["latency_ms"] = int((time.time() - started) * 1000)
        return normalized

    graph_result = _fetch_via_graph_scrape(
        terms=terms,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        timeout=timeout,
        retries=retries,
        headers=headers,
    )
    if "raw" in graph_result:
        normalized = _normalize_series_payload(graph_result)
        normalized["latency_ms"] = int((time.time() - started) * 1000)
        return normalized

    raise RuntimeError(
        "gbnc_request_failed: "
        + f"json=({json_result.get('error')}); "
        + f"graph=({graph_result.get('error')})"
    )
