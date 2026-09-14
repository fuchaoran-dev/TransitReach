from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path


def build_registry(features: Path, stops_file: Path, routes_file: Path, model: Path, metadata_file: Path, output: Path) -> dict:
    import duckdb

    stop_names: dict[str, str] = {}
    with stops_file.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            stop_names[row["stop_id"]] = row["stop_name"]
    route_names: dict[str, str] = {}
    with routes_file.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            route_names[row["route_id"]] = " ".join(filter(None, [
                row.get("route_short_name", ""), row.get("route_long_name", "")
            ])) or row["route_id"]
    source = str(features).replace("'", "''")
    connection = duckdb.connect()
    rows = connection.execute(f"""
      SELECT route_id, stop_id, hour, is_weekend,
        count(*) sample_count,
        round(avg(stop_sequence))::INTEGER stop_sequence,
        avg(target_delay_minutes) historical_mean_delay,
        median(target_delay_minutes) historical_median_delay,
        quantile_cont(target_delay_minutes, .25) p25,
        quantile_cont(target_delay_minutes, .50) p50,
        quantile_cont(target_delay_minutes, .75) p75,
        stddev_samp(target_delay_minutes) residual_scale
      FROM read_parquet('{source}')
      GROUP BY route_id, stop_id, hour, is_weekend
      HAVING count(*) >= 10
    """).fetchall()
    fallback_rows = connection.execute(f"""
      SELECT route_id, stop_id, count(*) sample_count,
        round(avg(stop_sequence))::INTEGER stop_sequence,
        avg(target_delay_minutes), median(target_delay_minutes),
        quantile_cont(target_delay_minutes, .25), quantile_cont(target_delay_minutes, .50),
        quantile_cont(target_delay_minutes, .75), stddev_samp(target_delay_minutes)
      FROM read_parquet('{source}') GROUP BY route_id, stop_id
      HAVING count(*) >= 20
    """).fetchall()
    connection.close()
    profiles = {}
    services: dict[str, dict] = {}
    for route_id, stop_id, hour, weekend, count, sequence, mean, med, p25, p50, p75, scale in rows:
        key = f"{route_id}|{stop_id}|{hour}|{int(weekend)}"
        profiles[key] = {
            "sample_count": count, "stop_sequence": sequence,
            "historical_mean_delay": mean, "historical_median_delay": med,
            "p25": p25, "p50": p50, "p75": p75, "residual_scale": scale,
        }
        service = services.setdefault(route_id, {"line_id": route_id, "name": route_names.get(route_id, route_id), "stops": {}})
        service["stops"][stop_id] = {"stop_id": stop_id, "name": stop_names.get(stop_id, stop_id)}

    metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    metadata.update({
        "model_version": "rapidkl-bus-historical-v1",
        "prediction_enabled": True,
        "scope": sorted(services),
        "label_method": "GPS geofence arrivals matched to contemporaneous KRI GTFS Static",
        "validation_status": "chronological_holdout_passed; manual arrival audit pending",
        "release_basis": "Scoped Rapid KL Bus MVP using GPS-derived labels; not MRT/LRT/BRT",
        "data_sources": ["KRI Greater Kuala Lumpur Mobilities", "Prasarana GTFS via data.gov.my"],
    })
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(model, output / "rapidkl-bus-historical-v1.cbm")
    fallback_profiles = {f"{route_id}|{stop_id}": {
        "sample_count": count, "stop_sequence": sequence,
        "historical_mean_delay": mean, "historical_median_delay": med,
        "p25": p25, "p50": p50, "p75": p75, "residual_scale": scale,
    } for route_id, stop_id, count, sequence, mean, med, p25, p50, p75, scale in fallback_rows}
    for route_id, service in services.items():
        service["stops"] = {
            stop_id: stop for stop_id, stop in service["stops"].items()
            if fallback_profiles.get(f"{route_id}|{stop_id}", {}).get("sample_count", 0) >= 20
        }
    registry = {"metadata": metadata, "services": [
        {**service, "stops": sorted(service["stops"].values(), key=lambda item: item["name"])}
        for service in services.values()
    ], "profiles": profiles, "fallback_profiles": fallback_profiles}
    (output / "rapidkl-bus-historical-v1.json").write_text(json.dumps(registry, indent=2), encoding="utf-8")
    return {"services": len(services), "profiles": len(profiles), "stops": sum(len(item["stops"]) for item in services.values())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--stops", required=True, type=Path)
    parser.add_argument("--routes", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(build_registry(args.features, args.stops, args.routes, args.model, args.metadata, args.output))


if __name__ == "__main__":
    main()
