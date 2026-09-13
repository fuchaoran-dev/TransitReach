from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date
from math import sqrt
from pathlib import Path
from statistics import median


FEATURES = ["route_id", "stop_id", "stop_sequence", "hour", "day_of_week", "is_weekend",
            "scheduled_headway", "historical_median_delay", "historical_mean_delay"]
CATEGORICAL = ["route_id", "stop_id"]


@dataclass(frozen=True)
class TrainingGate:
    minimum_events: int = 5_000
    minimum_service_days: int = 28


def chronological_boundaries(size: int) -> tuple[int, int]:
    if size < 3:
        raise ValueError("at least three chronological observations are required")
    return max(1, int(size * .70)), max(2, int(size * .85))


def metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    errors = [prediction - target for target, prediction in zip(actual, predicted, strict=True)]
    return {"mae": sum(abs(error) for error in errors) / len(errors),
            "rmse": sqrt(sum(error * error for error in errors) / len(errors))}


def train(
    feature_table: Path,
    artifact_directory: Path,
    gate: TrainingGate = TrainingGate(),
    *,
    arrival_validation_passed: bool = False,
) -> dict:
    import pyarrow.parquet as pq
    rows = sorted(pq.read_table(feature_table).to_pylist(), key=lambda row: row["scheduled_arrival"])
    days = {row["service_date"] for row in rows}
    if len(rows) < gate.minimum_events or len(days) < gate.minimum_service_days:
        raise RuntimeError(
            f"training gate failed: {len(rows)} events/{len(days)} days; "
            f"requires {gate.minimum_events} events/{gate.minimum_service_days} days"
        )
    from catboost import CatBoostRegressor
    train_end, validation_end = chronological_boundaries(len(rows))
    training, validation, test = rows[:train_end], rows[train_end:validation_end], rows[validation_end:]
    fallback = median(float(row["target_delay_minutes"]) for row in training)
    baseline_metrics = metrics(
        [float(row["target_delay_minutes"]) for row in test], [fallback] * len(test)
    )

    def matrix(partition: list[dict]) -> list[list[object]]:
        return [[row[name] if row[name] is not None else "missing" if name in CATEGORICAL else float("nan") for name in FEATURES] for row in partition]

    model = CatBoostRegressor(iterations=500, depth=7, learning_rate=.05, loss_function="RMSE",
                              random_seed=42, verbose=False)
    model.fit(matrix(training), [row["target_delay_minutes"] for row in training],
              cat_features=[FEATURES.index(name) for name in CATEGORICAL],
              eval_set=(matrix(validation), [row["target_delay_minutes"] for row in validation]),
              early_stopping_rounds=50)
    predictions = model.predict(matrix(test)).tolist()
    model_metrics = metrics([float(row["target_delay_minutes"]) for row in test], predictions)
    artifact_directory.mkdir(parents=True, exist_ok=True)
    version = f"historical-{date.today().isoformat()}"
    model.save_model(str(artifact_directory / f"{version}.cbm"))
    metadata = {
        "model_version": version, "model_type": "CatBoostRegressor",
        "training_start": str(training[0]["service_date"]), "training_end": str(training[-1]["service_date"]),
        "validation_start": str(validation[0]["service_date"]), "validation_end": str(validation[-1]["service_date"]),
        "test_start": str(test[0]["service_date"]), "test_end": str(test[-1]["service_date"]),
        "features": FEATURES, "baseline": baseline_metrics, "model": model_metrics,
        "arrival_validation_passed": arrival_validation_passed,
        "candidate_for_promotion": model_metrics["mae"] < baseline_metrics["mae"],
        "prediction_enabled": arrival_validation_passed and model_metrics["mae"] < baseline_metrics["mae"],
    }
    (artifact_directory / f"{version}.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--artifacts", default=Path("backend/models/artifacts"), type=Path)
    args = parser.parse_args()
    print(json.dumps(train(args.features, args.artifacts), indent=2))


if __name__ == "__main__":
    main()
