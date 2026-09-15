from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from math import isnan
from pathlib import Path

from catboost import CatBoostRegressor, Pool

from backend.app.schemas.reliability import ReliabilityPrediction, RiskLevel


REGISTRY_DIR = Path(__file__).resolve().parents[2] / "models" / "registry"
FEATURES = ["route_id", "stop_id", "stop_sequence", "hour", "day_of_week", "is_weekend",
            "scheduled_headway", "historical_median_delay", "historical_mean_delay"]
CATEGORICAL_INDICES = [0, 1]


@lru_cache(maxsize=1)
def _assets() -> tuple[dict, CatBoostRegressor]:
    registry = json.loads((REGISTRY_DIR / "rapidkl-bus-historical-v1.json").read_text())
    model = CatBoostRegressor()
    model.load_model(str(REGISTRY_DIR / "rapidkl-bus-historical-v1.cbm"))
    return registry, model


def service_catalog() -> list[dict]:
    return _assets()[0]["services"]


def _risk(delay: float, profile: dict) -> tuple[RiskLevel, float]:
    if delay <= profile["p25"]:
        return RiskLevel.low, 12.5
    if delay <= profile["p50"]:
        return RiskLevel.moderate, 37.5
    if delay <= profile["p75"]:
        return RiskLevel.high, 62.5
    return RiskLevel.very_high, 87.5


def predict_historical(line_id: str, stop_id: str, travel_at: datetime) -> ReliabilityPrediction | None:
    registry, model = _assets()
    weekend = int(travel_at.isoweekday() >= 6)
    profile = registry["profiles"].get(f"{line_id}|{stop_id}|{travel_at.hour}|{weekend}")
    level = "stop_time"
    confidence = "high"
    if profile is None or profile["sample_count"] < 10:
        profile = registry["fallback_profiles"].get(f"{line_id}|{stop_id}")
        level, confidence = "stop", "medium"
    if profile is None or profile["sample_count"] < 20:
        profile = registry.get("route_profiles", {}).get(
            f"{line_id}|{travel_at.hour}|{weekend}"
        )
        level, confidence = "route", "low"
    if profile is None:
        profile = registry.get("network_profiles", {}).get(f"{travel_at.hour}|{weekend}")
        level, confidence = "network", "low"
    if profile is None:
        return None
    row: list[object] = [
        line_id, stop_id, profile["stop_sequence"], travel_at.hour, travel_at.isoweekday(),
        bool(weekend), float("nan"), profile["historical_median_delay"],
        profile["historical_mean_delay"],
    ]
    expected = float(model.predict([row])[0])
    risk, percentile = _risk(expected, profile)
    scale = profile.get("residual_scale") or 0
    if isinstance(scale, float) and isnan(scale):
        scale = 0
    lower, upper = expected - 1.645 * scale, expected + 1.645 * scale
    shap = model.get_feature_importance(Pool([row], cat_features=CATEGORICAL_INDICES), type="ShapValues")[0][:-1]
    messages = {
        "route_id": "This route's historical pattern contributed to the estimate.",
        "stop_id": "Historical observations at this stop contributed to the estimate.",
        "stop_sequence": "The stop's position along the route contributed to the estimate.",
        "hour": "Reliability around the selected hour contributed to the estimate.",
        "day_of_week": "Historical patterns for this day of the week contributed to the estimate.",
        "is_weekend": "Weekend versus weekday operating patterns contributed to the estimate.",
        "historical_median_delay": "The comparable historical median delay contributed to the estimate.",
        "historical_mean_delay": "The comparable historical mean delay contributed to the estimate.",
    }
    explanations = [messages[FEATURES[index]] for index in sorted(
        range(len(FEATURES)), key=lambda index: abs(shap[index]), reverse=True
    ) if FEATURES[index] in messages][:3]
    metadata = registry["metadata"]
    return ReliabilityPrediction(
        prediction_type="historical", prediction_level=level, confidence=confidence,
        sample_count=profile["sample_count"], is_fallback=level in {"route", "network"},
        expected_delay_min=round(expected, 2), risk_level=risk,
        historical_percentile=percentile, prediction_lower_min=round(lower, 2),
        prediction_upper_min=round(upper, 2), realtime_used=False,
        model_version=metadata["model_version"], model_type=metadata["model_type"],
        data_sources=metadata["data_sources"],
        training_period=f"{metadata['training_start']} to {metadata['training_end']}",
        evaluation={"mae": metadata["model"]["mae"], "rmse": metadata["model"]["rmse"],
                    "baseline_mae": metadata["baseline"]["mae"],
                    "baseline_rmse": metadata["baseline"]["rmse"]},
        explanations=explanations,
        disclaimer=(f"{level.replace('_', ' ').title()}-level AI estimate trained on GPS-derived "
                    "stop arrivals; manual arrival audit is pending. It is not a guaranteed arrival time."),
    )
