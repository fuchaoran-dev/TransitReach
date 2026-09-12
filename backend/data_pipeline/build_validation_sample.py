from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


def _anonymous(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def build_sample(source_root: Path, output: Path, routes: tuple[str, ...], per_route: int = 150) -> dict:
    selected: list[dict[str, str]] = []
    counts: dict[str, int] = {}
    for route_id in routes:
        candidates: list[dict[str, str]] = []
        seen: set[tuple[str, ...]] = set()
        for source in sorted((source_root / route_id).glob("matched_*.csv")):
            with source.open(encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    key = (source.stem, row.get("vehicle_id", ""), row.get("shift_id", ""), row.get("stop_id", ""))
                    if key in seen:
                        continue
                    seen.add(key)
                    candidates.append({
                        "sample_id": "",
                        "route_id": route_id,
                        "service_date": source.stem[-10:].replace("_", "-"),
                        "trip_instance": _anonymous("|".join(key[:3])),
                        "stop_sequence": row.get("stop_id", ""),
                        "stop_name": row.get("stop_name", ""),
                        "stop_id": row.get("bus_stop_id", ""),
                        "reference_arrival": row.get("malaysia_time", ""),
                        "annotated_actual_arrival": "",
                        "annotator_id": "",
                        "confidence": "",
                        "gps_gap_seconds": "",
                        "exclude_reason": "",
                        "notes": "",
                    })
        if not candidates:
            counts[route_id] = 0
            continue
        step = max(1, len(candidates) // per_route)
        route_sample = candidates[::step][:per_route]
        counts[route_id] = len(route_sample)
        selected.extend(route_sample)
    for index, row in enumerate(selected, 1):
        row["sample_id"] = f"VAL-{index:04d}"
    output.parent.mkdir(parents=True, exist_ok=True)
    if not selected:
        raise RuntimeError("no reference events found")
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(selected[0]))
        writer.writeheader()
        writer.writerows(selected)
    return {"rows": len(selected), "routes": counts, "status": "awaiting_manual_annotation"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--routes", nargs="+", required=True)
    parser.add_argument("--per-route", type=int, default=150)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = build_sample(args.source, args.output, tuple(args.routes), args.per_route)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
