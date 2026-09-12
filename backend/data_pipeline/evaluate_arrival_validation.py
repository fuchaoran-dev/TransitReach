from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from math import sqrt
from pathlib import Path


def validation_metrics(errors_seconds: list[float], false_matches: int, reviewed: int) -> dict[str, float]:
    if not errors_seconds or reviewed <= 0:
        raise ValueError("no reviewed validation rows")
    absolute = [abs(value) for value in errors_seconds]
    return {
        "mae_seconds": sum(absolute) / len(absolute),
        "rmse_seconds": sqrt(sum(value * value for value in errors_seconds) / len(errors_seconds)),
        "within_60_seconds": sum(value <= 60 for value in absolute) / len(absolute),
        "within_120_seconds": sum(value <= 120 for value in absolute) / len(absolute),
        "false_match_rate": false_matches / reviewed,
    }


def evaluate(path: Path, minimum_reviewed: int = 300) -> dict[str, object]:
    errors: list[float] = []
    reviewed = false_matches = 0
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotation = row.get("annotated_actual_arrival", "").strip()
            exclusion = row.get("exclude_reason", "").strip().lower()
            if annotation or exclusion:
                reviewed += 1
            if exclusion == "false_match":
                false_matches += 1
            if annotation and not exclusion:
                predicted = datetime.fromisoformat(row["reference_arrival"].replace("Z", "+00:00"))
                actual = datetime.fromisoformat(annotation.replace("Z", "+00:00"))
                errors.append((predicted - actual).total_seconds())
    result = validation_metrics(errors, false_matches, reviewed) if errors else {}
    passed = (
        reviewed >= minimum_reviewed
        and bool(result)
        and result["mae_seconds"] <= 90
        and result["within_120_seconds"] >= .90
        and result["false_match_rate"] <= .02
    )
    return {"reviewed": reviewed, "timed_arrivals": len(errors), "thresholds": {
        "minimum_reviewed": minimum_reviewed, "maximum_mae_seconds": 90,
        "minimum_within_120_seconds": .90, "maximum_false_match_rate": .02,
    }, "metrics": result, "arrival_validation_passed": passed}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate(args.input)
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
