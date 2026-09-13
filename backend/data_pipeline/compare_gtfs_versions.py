from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def _read(path: Path, name: str) -> list[dict[str, str]]:
    target = path / name
    if not target.is_file():
        return []
    with target.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _ids(rows: list[dict[str, str]], field: str) -> set[str]:
    return {row[field] for row in rows if row.get(field)}


def compare(old: Path, new: Path, route_ids: tuple[str, ...] = ()) -> dict[str, object]:
    old_routes, new_routes = _read(old, "routes.txt"), _read(new, "routes.txt")
    old_stops, new_stops = _read(old, "stops.txt"), _read(new, "stops.txt")
    old_times, new_times = _read(old, "stop_times.txt"), _read(new, "stop_times.txt")
    old_route_ids, new_route_ids = _ids(old_routes, "route_id"), _ids(new_routes, "route_id")
    old_stop_ids, new_stop_ids = _ids(old_stops, "stop_id"), _ids(new_stops, "stop_id")
    old_trip_ids, new_trip_ids = _ids(old_times, "trip_id"), _ids(new_times, "trip_id")
    selected = set(route_ids)

    def route_for_trip(trip_id: str) -> str | None:
        return next((route for route in selected if f"_{route}_" in trip_id), None)

    per_route: dict[str, object] = {}
    for route_id in sorted(selected):
        old_trips = {trip for trip in old_trip_ids if route_for_trip(trip) == route_id}
        new_trips = {trip for trip in new_trip_ids if route_for_trip(trip) == route_id}
        old_route_times = [row for row in old_times if row.get("trip_id") in old_trips]
        new_route_times = [row for row in new_times if row.get("trip_id") in new_trips]
        per_route[route_id] = {
            "old_trip_templates": len(old_trips), "new_trip_templates": len(new_trips),
            "shared_trip_templates": len(old_trips & new_trips),
            "old_stop_time_rows": len(old_route_times), "new_stop_time_rows": len(new_route_times),
            "shared_stop_ids": len(_ids(old_route_times, "stop_id") & _ids(new_route_times, "stop_id")),
        }
    return {
        "old": str(old), "new": str(new),
        "routes": {"old": len(old_route_ids), "new": len(new_route_ids),
                   "shared": len(old_route_ids & new_route_ids)},
        "stops": {"old": len(old_stop_ids), "new": len(new_stop_ids),
                  "shared": len(old_stop_ids & new_stop_ids)},
        "trip_templates": {"old": len(old_trip_ids), "new": len(new_trip_ids),
                           "shared": len(old_trip_ids & new_trip_ids)},
        "frequency_rows": {"old": len(_read(old, "frequencies.txt")),
                           "new": len(_read(new, "frequencies.txt"))},
        "selected_routes": per_route,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old", required=True, type=Path)
    parser.add_argument("--new", required=True, type=Path)
    parser.add_argument("--routes", nargs="*", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = compare(args.old, args.new, tuple(args.routes))
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
