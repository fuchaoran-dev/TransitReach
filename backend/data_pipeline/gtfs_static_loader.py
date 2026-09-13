from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .shape_matcher import ShapePoint


@dataclass(frozen=True)
class GtfsStop:
    stop_id: str
    name: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class ScheduledStop:
    trip_id: str
    route_id: str
    stop_id: str
    stop_sequence: int
    arrival_seconds: int


@dataclass(frozen=True)
class StaticSchedule:
    stops: dict[str, GtfsStop]
    trips: dict[str, str]
    trip_shapes: dict[str, str]
    shapes: dict[str, tuple[ShapePoint, ...]]
    stop_times_by_trip: dict[str, tuple[ScheduledStop, ...]]


def parse_gtfs_time(value: str) -> int:
    """GTFS hours may exceed 23 for service continuing after midnight."""
    parts = value.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"invalid GTFS time: {value!r}")
    hour, minute, second = (int(part) for part in parts)
    if hour < 0 or not 0 <= minute < 60 or not 0 <= second < 60:
        raise ValueError(f"invalid GTFS time: {value!r}")
    return hour * 3600 + minute * 60 + second


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_gtfs_static(directory: Path) -> StaticSchedule:
    required = ("stops.txt", "stop_times.txt")
    missing = [name for name in required if not (directory / name).is_file()]
    if missing:
        raise FileNotFoundError(f"missing GTFS files: {', '.join(missing)}")

    stops = {
        row["stop_id"]: GtfsStop(
            row["stop_id"], row.get("stop_name", row["stop_id"]),
            float(row["stop_lat"]), float(row["stop_lon"]),
        )
        for row in _rows(directory / "stops.txt")
    }
    trip_rows = _rows(directory / "trips.txt") if (directory / "trips.txt").is_file() else []
    trips = {row["trip_id"]: row["route_id"] for row in trip_rows}
    trip_shapes = {row["trip_id"]: row["shape_id"] for row in trip_rows if row.get("shape_id")}
    shape_groups: dict[str, list[ShapePoint]] = {}
    if (directory / "shapes.txt").is_file():
        for row in _rows(directory / "shapes.txt"):
            shape_groups.setdefault(row["shape_id"], []).append(ShapePoint(
                float(row["shape_pt_lat"]), float(row["shape_pt_lon"]), int(row["shape_pt_sequence"])
            ))
    stop_time_rows = _rows(directory / "stop_times.txt")
    if not trips:
        route_ids = sorted(
            (row["route_id"] for row in _rows(directory / "routes.txt")), key=len, reverse=True
        )
        for trip_id in {row["trip_id"] for row in stop_time_rows}:
            matches = [route_id for route_id in route_ids if f"_{route_id}_" in trip_id]
            if len(matches) == 1:
                trips[trip_id] = matches[0]
    grouped: dict[str, list[ScheduledStop]] = {}
    for row in stop_time_rows:
        trip_id, stop_id = row["trip_id"], row["stop_id"]
        if trip_id not in trips or stop_id not in stops:
            continue
        grouped.setdefault(trip_id, []).append(ScheduledStop(
            trip_id=trip_id,
            route_id=trips[trip_id],
            stop_id=stop_id,
            stop_sequence=int(row["stop_sequence"]),
            arrival_seconds=parse_gtfs_time(row["arrival_time"]),
        ))
    return StaticSchedule(
        stops=stops,
        trips=trips,
        trip_shapes=trip_shapes,
        shapes={key: tuple(sorted(points, key=lambda point: point.sequence)) for key, points in shape_groups.items()},
        stop_times_by_trip={
            trip_id: tuple(sorted(items, key=lambda item: item.stop_sequence))
            for trip_id, items in grouped.items()
        },
    )
