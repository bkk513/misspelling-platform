from __future__ import annotations

from typing import Any

import numpy as np

from .types import AlgorithmDataset


def _origin_index(years: list[int], origin_year: int | None) -> int:
    if not years:
        return 0
    if origin_year is None:
        return 0
    target = int(origin_year)
    for idx, year in enumerate(years):
        if int(year) >= target:
            return idx
    return max(0, len(years) - 1)


def _normalize(values: list[float]) -> list[float]:
    if not values:
        return []
    min_value = float(min(values))
    max_value = float(max(values))
    if abs(max_value - min_value) <= 1e-12:
        return [0.0 for _ in values]
    return [(float(v) - min_value) / (max_value - min_value) for v in values]


def _exponential_smoothing(values: list[float], alpha: float) -> list[float]:
    if not values:
        return []
    smoothed = [float(values[0])]
    for value in values[1:]:
        smoothed.append(float(alpha) * float(value) + (1.0 - float(alpha)) * smoothed[-1])
    return smoothed


def _build_signals(dataset: AlgorithmDataset) -> tuple[np.ndarray, np.ndarray]:
    correct = np.asarray(dataset.series[0].values, dtype=float)
    if len(dataset.series) > 1:
        miss = np.sum(np.asarray([row.values for row in dataset.series[1:]], dtype=float), axis=0)
    else:
        miss = np.zeros_like(correct)
    total_signal = correct + miss
    return correct, total_signal


def _detect_peak_window(
    series: np.ndarray,
    origin_index: int,
    years: list[int],
    window_size: int,
) -> dict[str, Any]:
    import pandas as pd

    if len(series) == 0:
        return {
            "origin_year": None,
            "peak_year": None,
            "end_year": None,
            "range_source": "empty_series",
        }

    safe_origin = max(0, min(int(origin_index), len(series) - 1))
    working = np.asarray(series[safe_origin:], dtype=float)
    smoothed = pd.Series(working).rolling(int(window_size)).mean().to_numpy()
    diff = np.diff(smoothed)
    zero_crossings = np.where(np.diff(np.sign(diff)) != 0)[0]

    peak_indices = [
        int(crossing)
        for crossing in zero_crossings
        if crossing + 1 < len(diff) and diff[crossing] > 0 and diff[crossing + 1] < 0
    ]
    valley_indices = [
        int(crossing)
        for crossing in zero_crossings
        if crossing + 1 < len(diff) and diff[crossing] < 0 and diff[crossing + 1] > 0
    ]

    origin_year = int(years[safe_origin])
    if peak_indices:
        first_peak_year = int(years[safe_origin + peak_indices[0]])
        first_valley_year = next(
            (int(years[safe_origin + item]) for item in valley_indices if item > peak_indices[0]),
            None,
        )
        if first_valley_year is not None:
            return {
                "origin_year": origin_year,
                "peak_year": first_peak_year,
                "end_year": first_valley_year,
                "range_source": "first_peak_to_first_valley",
            }
        if len(peak_indices) > 1:
            return {
                "origin_year": origin_year,
                "peak_year": first_peak_year,
                "end_year": int(years[safe_origin + peak_indices[1]]),
                "range_source": "first_peak_to_second_peak",
            }
        return {
            "origin_year": origin_year,
            "peak_year": first_peak_year,
            "end_year": int(years[-1]),
            "range_source": "first_peak_to_series_end",
        }
    return {
        "origin_year": origin_year,
        "peak_year": origin_year,
        "end_year": int(years[-1]),
        "range_source": "origin_to_series_end_no_peak",
    }


def _bayesian_bootstrap_case(
    values: np.ndarray,
    window_size: int,
    start_year: int,
    end_year: int,
    base_year: int,
    draw_count: int,
) -> tuple[list[float], int]:
    import scipy.stats as ss
    from pyod.models.knn import KNN

    data = np.asarray(values, dtype=float)
    if len(data) <= 2:
        return [0.0 for _ in data.tolist()], max(base_year, start_year)

    clf = KNN()
    clf.fit(data.reshape(-1, 1))
    scores = np.asarray(clf.decision_scores_, dtype=float)
    if np.max(scores) - np.min(scores) <= 1e-12:
        weights = np.ones_like(scores, dtype=float)
    else:
        normalized_scores = (scores - scores.min() + 1e-10) / (scores.max() - scores.min() + 1e-10)
        weights = 1.0 - normalized_scores + 1e-10

    safe_window = max(3, min(int(window_size), len(data)))
    safe_draws = max(128, int(draw_count))
    stds: list[float] = []
    for idx in range(safe_window, len(data)):
        window_data = data[idx - safe_window : idx]
        window_weights = weights[idx - safe_window : idx]
        mean_weight = max(float(np.mean(window_weights)), 1e-8)
        alpha = np.clip(window_weights / mean_weight, 1e-6, None)
        draws = ss.dirichlet(alpha).rvs(safe_draws)
        means = (draws * window_data).sum(axis=1)
        vars_ = draws * (window_data - means.reshape(safe_draws, 1)) ** 2
        stds.append(float(np.sqrt(vars_.sum(axis=1)).mean()))

    start_offset = max(0, int(start_year) - int(base_year))
    end_offset = max(start_offset + 1, min(int(end_year) - int(base_year), len(stds)))
    focus = stds[start_offset:end_offset]
    if not focus:
        return [0.0 for _ in data.tolist()], int(start_year)

    smoothed = _exponential_smoothing(focus, alpha=0.3)
    normalized = _normalize(smoothed)
    normalized = [0.0, *normalized, 0.0]

    padded = [0.0 for _ in data.tolist()]
    for index, value in enumerate(normalized):
        write_index = start_offset + index
        if 0 <= write_index < len(padded):
            padded[write_index] = float(value)

    mutation_year = int(base_year + start_offset + int(np.argmax(np.asarray(normalized, dtype=float))))
    return padded, mutation_year


def _predict_counterfactual(
    correct_signal: np.ndarray,
    total_signal: np.ndarray,
    actual_mutation_year: int,
    base_year: int,
    random_seed: int,
) -> np.ndarray:
    import os

    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    import keras
    import tensorflow as tf
    from ncps import wirings
    from ncps.keras import CfC

    keras.backend.clear_session()
    tf.random.set_seed(int(random_seed))
    np.random.seed(int(random_seed))

    train_length = max(4, min(len(correct_signal), int(actual_mutation_year) - int(base_year)))
    fc_wiring = wirings.FullyConnected(8, 1)
    model = keras.models.Sequential(
        [
            keras.layers.Input(shape=(None, 1), dtype="float32"),
            CfC(fc_wiring, return_sequences=True),
        ]
    )
    model.compile(optimizer=keras.optimizers.Adam(0.01), loss=keras.losses.MeanSquaredError())

    train_x = correct_signal[:train_length].reshape(1, train_length, 1).astype(np.float32)
    train_y = total_signal[:train_length].reshape(1, train_length, 1).astype(np.float32)
    full_x = correct_signal.reshape(1, len(correct_signal), 1).astype(np.float32)

    model.fit(x=train_x, y=train_y, batch_size=8, epochs=10, verbose=0, shuffle=False)
    prediction = model(full_x).numpy()[0, :, 0]
    prediction = np.where(prediction < 0, -prediction, prediction)
    keras.backend.clear_session()
    return np.asarray(prediction, dtype=float)


def run_delta_t(
    dataset: AlgorithmDataset,
    origin_year: int | None = None,
    bootstrap_samples: int = 500,
    event_threshold_quantile: float = 0.9,
    random_seed: int = 42,
) -> dict[str, Any]:
    warnings = list(dataset.warnings)
    if not dataset.series or not dataset.years:
        return {
            "summary": {
                "points": 0,
                "origin_year": origin_year,
                "actual_mutation_year": None,
                "predicted_mutation_year": None,
                "delta_t_years": None,
            },
            "events": [],
            "warnings": warnings + ["empty_dataset"],
            "mode": "stub",
            "impl": "fig6_notebook_port",
        }

    base_year = int(dataset.years[0])
    effective_origin_index = _origin_index(dataset.years, origin_year)
    effective_origin_year = int(dataset.years[effective_origin_index])
    correct_signal, total_signal = _build_signals(dataset)

    if len(total_signal) < 8:
        warnings.append("insufficient_points_after_origin")
        return {
            "summary": {
                "points": len(total_signal),
                "origin_year": effective_origin_year,
                "actual_mutation_year": None,
                "predicted_mutation_year": None,
                "delta_t_years": None,
            },
            "events": [],
            "warnings": warnings,
            "mode": dataset.mode,
            "impl": "fig6_notebook_port",
        }

    actual_window = _detect_peak_window(total_signal, effective_origin_index, dataset.years, window_size=7)
    actual_peak_year = int(actual_window["peak_year"] or effective_origin_year)
    actual_end_year = int(actual_window["end_year"] or dataset.years[-1])
    actual_bootstrap, actual_mutation_year = _bayesian_bootstrap_case(
        total_signal,
        window_size=5,
        start_year=actual_peak_year,
        end_year=actual_end_year,
        base_year=base_year,
        draw_count=bootstrap_samples,
    )

    predicted_signal = _predict_counterfactual(
        correct_signal=correct_signal,
        total_signal=total_signal,
        actual_mutation_year=actual_mutation_year,
        base_year=base_year,
        random_seed=random_seed,
    )
    predicted_start_index = _origin_index(dataset.years, actual_mutation_year)
    predicted_window = _detect_peak_window(predicted_signal, predicted_start_index, dataset.years, window_size=5)
    predicted_peak_year = int(predicted_window["peak_year"] or actual_mutation_year)
    predicted_end_year = int(predicted_window["end_year"] or dataset.years[-1])
    predicted_bootstrap, predicted_mutation_year = _bayesian_bootstrap_case(
        predicted_signal,
        window_size=5,
        start_year=predicted_peak_year,
        end_year=predicted_end_year,
        base_year=base_year,
        draw_count=bootstrap_samples,
    )

    delta_t_years = float(predicted_mutation_year - actual_mutation_year)
    delay_years = float(max(0.0, delta_t_years))
    correct_share = np.divide(
        correct_signal,
        np.maximum(total_signal, 1e-12),
        out=np.zeros_like(correct_signal, dtype=float),
        where=np.maximum(total_signal, 1e-12) > 0,
    )

    events: list[dict[str, Any]] = []
    for idx, year in enumerate(dataset.years):
        events.append(
            {
                "year": int(year),
                "correct": float(correct_signal[idx]),
                "misspelling_total": float(max(total_signal[idx] - correct_signal[idx], 0.0)),
                "actual_total": float(total_signal[idx]),
                "predicted_correct": float(predicted_signal[idx]),
                "predicted_counterfactual": float(predicted_signal[idx]),
                "correct_share": float(correct_share[idx]),
                "actual_bootstrap": float(actual_bootstrap[idx] if idx < len(actual_bootstrap) else 0.0),
                "predicted_bootstrap": float(predicted_bootstrap[idx] if idx < len(predicted_bootstrap) else 0.0),
                "actual_focus": 1 if actual_peak_year <= int(year) <= actual_end_year else 0,
                "predicted_focus": 1 if predicted_peak_year <= int(year) <= predicted_end_year else 0,
                "actual_mutation": 1 if int(year) == actual_mutation_year else 0,
                "predicted_mutation": 1 if int(year) == predicted_mutation_year else 0,
                "event_threshold": float(event_threshold_quantile),
            }
        )

    return {
        "word": dataset.word,
        "summary": {
            "points": len(dataset.years),
            "base_year": base_year,
            "origin_year": effective_origin_year,
            "actual_peak_year": actual_peak_year,
            "actual_range_end_year": actual_end_year,
            "predicted_peak_year": predicted_peak_year,
            "predicted_range_end_year": predicted_end_year,
            "actual_mutation_year": int(actual_mutation_year),
            "predicted_mutation_year": int(predicted_mutation_year),
            "delta_t_years": delta_t_years,
            "delay_years": delay_years,
            "signal_definition": "all_signal = correct_frequency + sum(misspelling_frequency)",
            "counterfactual_definition": "CfC notebook port trained from correct series to reconstruct the notebook counterfactual trajectory",
            "bootstrap_draws": int(bootstrap_samples),
            "method": "fig6_notebook_port",
        },
        "series": {
            "years": [int(year) for year in dataset.years],
            "actual_total": [float(v) for v in total_signal.tolist()],
            "observed_correct": [float(v) for v in correct_signal.tolist()],
            "misspelling_total": [float(max(total_signal[idx] - correct_signal[idx], 0.0)) for idx in range(len(total_signal))],
            "predicted_correct": [float(v) for v in predicted_signal.tolist()],
            "predicted_counterfactual": [float(v) for v in predicted_signal.tolist()],
            "actual_bootstrap": [float(v) for v in actual_bootstrap],
            "predicted_bootstrap": [float(v) for v in predicted_bootstrap],
        },
        "ranges": {
            "actual": {
                "origin_year": effective_origin_year,
                "peak_year": actual_peak_year,
                "end_year": actual_end_year,
                "range_source": actual_window["range_source"],
            },
            "predicted": {
                "origin_year": int(actual_mutation_year),
                "peak_year": predicted_peak_year,
                "end_year": predicted_end_year,
                "range_source": predicted_window["range_source"],
            },
        },
        "events": events,
        "delta_t_stats": {
            "actual_mutation_year": int(actual_mutation_year),
            "predicted_mutation_year": int(predicted_mutation_year),
            "delta_t_years": delta_t_years,
            "delay_years": delay_years,
            "tipping_year": effective_origin_year,
        },
        "warnings": warnings,
        "mode": dataset.mode,
        "impl": "fig6_notebook_port",
    }


def to_event_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload.get("events") or []:
        rows.append(
            {
                "year": item.get("year"),
                "correct": item.get("correct"),
                "misspelling_total": item.get("misspelling_total"),
                "actual_total": item.get("actual_total"),
                "predicted_correct": item.get("predicted_correct"),
                "correct_share": item.get("correct_share"),
                "actual_bootstrap": item.get("actual_bootstrap"),
                "predicted_bootstrap": item.get("predicted_bootstrap"),
                "actual_focus": item.get("actual_focus"),
                "predicted_focus": item.get("predicted_focus"),
                "actual_mutation": item.get("actual_mutation"),
                "predicted_mutation": item.get("predicted_mutation"),
                "event_threshold": item.get("event_threshold"),
            }
        )
    return rows
