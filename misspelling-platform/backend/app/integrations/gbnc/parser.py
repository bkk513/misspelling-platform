from .types import GbncFetchResult, SeriesPoint, VariantSeries


def _safe_float(v) -> float:
    try:
        return float(v)
    except Exception:
        return 0.0


def parse_gbnc_json(payload, corpus: str, smoothing: int) -> GbncFetchResult:
    series: list[VariantSeries] = []
    warnings: list[str] = []

    if not isinstance(payload, list):
        warnings.append("invalid_payload")
        return GbncFetchResult(
            source="GBNC",
            corpus=corpus,
            smoothing=smoothing,
            unit="relative_frequency",
            series=[],
            warnings=warnings,
        )

    for item in payload:
        if not isinstance(item, dict):
            continue
        term = str(item.get("ngram") or "").strip()
        values = item.get("timeseries")
        start_year = int(item.get("parent_start") or item.get("year_start") or 0)
        if not term or not isinstance(values, list) or start_year <= 0:
            continue
        points = [SeriesPoint(year=start_year + idx, value=_safe_float(v)) for idx, v in enumerate(values)]
        series.append(VariantSeries(variant=term, points=points))

    if not series:
        warnings.append("no_series")

    return GbncFetchResult(
        source="GBNC",
        corpus=corpus,
        smoothing=smoothing,
        unit="relative_frequency",
        series=series,
        warnings=warnings,
    )
