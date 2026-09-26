from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from math import isnan
from pathlib import Path

from catboost import CatBoostRegressor, Pool

from backend.app.database import connection
from backend.app.schemas.reliability import ReliabilityPrediction, RiskLevel


REGISTRY_DIR = Path(__file__).resolve().parents[2] / "models" / "registry"
FEATURES = ["route_id", "stop_id", "stop_sequence", "hour", "day_of_week", "is_weekend",
            "scheduled_headway", "historical_median_delay", "historical_mean_delay"]
CATEGORICAL_INDICES = [0, 1]


@lru_cache(maxsize=1)
def _model() -> CatBoostRegressor:
    model = CatBoostRegressor()
    model.load_model(str(REGISTRY_DIR / "rapidkl-bus-historical-v1.cbm"))
    return model


@lru_cache(maxsize=1)
def service_catalog() -> list[dict]:
    with connection() as database:
        rows = database.execute("""
            select r.route_id as line_id, r.long_name as name, s.stop_id,
                   s.name as stop_name, min(rs.stop_sequence)::int as stop_sequence
            from public.model_scope_routes scope
            join public.model_versions mv using(model_version)
            join public.transit_routes r on r.route_id=scope.route_id
            join public.route_stops rs on rs.route_id=r.route_id
            join public.transit_stops s on s.stop_id=rs.stop_id
            where mv.prediction_enabled
            group by r.route_id, r.long_name, s.stop_id, s.name
            order by r.route_id, stop_sequence, s.stop_id
        """).fetchall()
    services: dict[str, dict] = {}
    for row in rows:
        service = services.setdefault(row["line_id"], {
            "line_id": row["line_id"], "name": row["name"], "stops": []})
        service["stops"].append({"stop_id": row["stop_id"], "name": row["stop_name"],
                                 "stop_sequence": row["stop_sequence"]})
    return list(services.values())


def _profile(database, version: str, level: str, key: str) -> dict | None:
    return database.execute("""
        select * from public.reliability_profiles
        where model_version=%s and profile_level=%s and profile_key=%s
    """, (version, level, key)).fetchone()


def _risk(delay: float, profile: dict) -> tuple[RiskLevel, float]:
    if delay <= profile["p25"]:
        return RiskLevel.low, 12.5
    if delay <= profile["p50"]:
        return RiskLevel.moderate, 37.5
    if delay <= profile["p75"]:
        return RiskLevel.high, 62.5
    return RiskLevel.very_high, 87.5


def predict_historical(line_id: str, stop_id: str, travel_at: datetime) -> ReliabilityPrediction | None:
    weekend = int(travel_at.isoweekday() >= 6)
    with connection() as database:
        metadata = database.execute("""
            select * from public.model_versions where prediction_enabled
            order by created_at desc limit 1
        """).fetchone()
        if metadata is None:
            return None
        version = metadata["model_version"]
        profile = _profile(database, version, "stop_time",
                           f"{line_id}|{stop_id}|{travel_at.hour}|{weekend}")
        level, confidence = "stop_time", "high"
        if profile is None or profile["sample_count"] < 10:
            profile = _profile(database, version, "stop", f"{line_id}|{stop_id}")
            level, confidence = "stop", "medium"
        if profile is None or profile["sample_count"] < 20:
            profile = _profile(database, version, "route",
                               f"{line_id}|{travel_at.hour}|{weekend}")
            level, confidence = "route", "low"
        if profile is None:
            profile = _profile(database, version, "network", f"{travel_at.hour}|{weekend}")
            level, confidence = "network", "low"
        data_sources = [row["source_name"] for row in database.execute("""
            select source_name from public.model_data_sources
            where model_version=%s order by source_name
        """, (version,))]
    if profile is None:
        return None
    row: list[object] = [
        line_id, stop_id, profile["stop_sequence"], travel_at.hour, travel_at.isoweekday(),
        bool(weekend), float("nan"), profile["historical_median_delay"],
        profile["historical_mean_delay"],
    ]
    model = _model()
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
    return ReliabilityPrediction(
        prediction_type="historical", prediction_level=level, confidence=confidence,
        sample_count=profile["sample_count"], is_fallback=level in {"route", "network"},
        expected_delay_min=round(expected, 2), risk_level=risk,
        historical_percentile=percentile, prediction_lower_min=round(lower, 2),
        prediction_upper_min=round(upper, 2), realtime_used=False,
        model_version=metadata["model_version"], model_type=metadata["model_type"],
        data_sources=data_sources,
        training_period=f"{metadata['training_start']} to {metadata['training_end']}",
        evaluation={"mae": metadata["model_mae"], "rmse": metadata["model_rmse"],
                    "baseline_mae": metadata["baseline_mae"],
                    "baseline_rmse": metadata["baseline_rmse"]},
        explanations=explanations,
        disclaimer=(f"{level.replace('_', ' ').title()}-level AI estimate trained on GPS-derived "
                    "stop arrivals; manual arrival audit is pending. It is not a guaranteed arrival time."),
    )
