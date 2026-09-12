from __future__ import annotations

import argparse
import json
from pathlib import Path

from .build_stop_arrivals import build_parquet


def build_network(cleaned: Path, gtfs: Path, output: Path, minimum_observations: int = 5_000) -> dict:
    import duckdb

    output.mkdir(parents=True, exist_ok=True)
    temporary = output / "_route_slice.parquet"
    connection = duckdb.connect()
    source = str(cleaned).replace("'", "''")
    coverage = connection.execute(f"""
      SELECT route_id, count(*) observations, count(distinct service_date) service_days
      FROM read_parquet('{source}') GROUP BY route_id ORDER BY route_id
    """).fetchall()
    report: dict[str, object] = {"routes": {}, "processed": 0, "eligible": 0}
    for route_id, observations, days in coverage:
        if observations < minimum_observations or days < 28:
            report["routes"][route_id] = {"status": "insufficient_observations", "observations": observations, "service_days": days}
            continue
        route_literal = route_id.replace("'", "''")
        if temporary.exists():
            temporary.unlink()
        connection.execute(f"COPY (SELECT * FROM read_parquet('{source}') WHERE route_id='{route_literal}') TO '{temporary}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        destination = output / f"route_{route_id}.parquet"
        if destination.exists():
            destination.unlink()
        try:
            result = build_parquet(temporary, gtfs, destination)
            status = "eligible" if result["training_eligible"] >= 500 else "insufficient_arrivals"
            report["routes"][route_id] = {"status": status, "observations": observations, "service_days": days, **result}
            report["processed"] += 1
            if status == "eligible":
                report["eligible"] += 1
        except RuntimeError as exc:
            report["routes"][route_id] = {"status": "no_gtfs_match", "reason": str(exc), "observations": observations, "service_days": days}
    if temporary.exists():
        temporary.unlink()
    connection.close()
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observations", required=True, type=Path)
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    report = build_network(args.observations, args.gtfs, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"processed": report["processed"], "eligible": report["eligible"]}))


if __name__ == "__main__":
    main()
