from __future__ import annotations

import argparse
import json
import os
from datetime import date
from pathlib import Path
from typing import Iterable, Iterator, Sequence


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "supabase" / "transit-data.sql"
REGISTRY = ROOT / "backend" / "models" / "registry" / "rapidkl-bus-historical-v1.json"
MODEL_VERSION = "rapidkl-bus-historical-v1"


def _load_local_environment() -> None:
    """Load ignored local secrets without requiring them in the agent parent process."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env.local", override=False)


def _connect(database_url: str | None = None):
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("Install backend/requirements.txt before migrating data") from exc
    _load_local_environment()
    url = database_url or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required (use the Supabase direct/session-pooler URI)")
    return psycopg.connect(url, connect_timeout=20)


def apply_schema(connection) -> None:
    connection.execute(SCHEMA.read_text(encoding="utf-8"))
    connection.commit()


def _load(path: str) -> object:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def _executemany(connection, query: str, rows: Iterable[Sequence[object]]) -> None:
    with connection.cursor() as cursor:
        cursor.executemany(query, rows)


def _copy_rows(connection, table: str, columns: Sequence[str],
               rows: Iterable[Sequence[object]]) -> int:
    """Stream many rows in one COPY operation instead of preparing one query per row."""
    statement = f"COPY public.{table} ({', '.join(columns)}) FROM STDIN"
    count = 0
    with connection.cursor() as cursor:
        with cursor.copy(statement) as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
    return count


def import_reference_data(connection) -> None:
    """Replace website reference datasets with normalized PostgreSQL rows."""
    bus_stops = _load("src/shared/data/bus/stops.json")
    rail_doc = _load("src/shared/data/rail/stops.json")
    feeds_doc = _load("src/shared/data/rail/feeds.json")
    patterns_doc = _load("src/shared/data/rail/line-patterns.json")
    shapes_doc = _load("src/shared/data/rail/shapes.json")
    places_doc = _load("src/shared/data/places/places.json")
    services_doc = _load("src/shared/data/services/services.json")

    with connection.transaction():
        for table in ("rail_shape_points", "rail_pattern_stops", "route_stops",
                      "rail_frequency_windows", "rail_service_calendars", "rail_feeds",
                      "dataset_metadata", "essential_services", "places", "transit_stops",
                      "transit_routes"):
            connection.execute(f"DELETE FROM public.{table}")

        routes = []
        for feed in feeds_doc["feeds"]:
            for line in feed["lines"]:
                routes.append((line["routeId"], line.get("shortName"), line["longName"],
                               line["mode"], line.get("color"), feed["feedId"]))
        registry = _load("backend/models/registry/rapidkl-bus-historical-v1.json")
        routes.extend((service["line_id"], service["line_id"], service["name"], "BUS", None,
                       "rapidkl-bus-registry") for service in registry["services"])
        _executemany(connection, """
            INSERT INTO public.transit_routes
              (route_id, short_name, long_name, mode, colour, source)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (route_id) DO UPDATE SET
              short_name=excluded.short_name, long_name=excluded.long_name,
              mode=excluded.mode, colour=excluded.colour, source=excluded.source,
              updated_at=now()
        """, routes)

        feed_rows = []
        calendar_rows = []
        frequency_rows = []
        for feed in feeds_doc["feeds"]:
            date_range = feed["serviceDateRange"]
            feed_rows.append((feed["feedId"], feed["feedName"], feed["agency"],
                              feed["source"], feed.get("licence"), feed.get("licenceStatus"),
                              date_range["start"], date_range["end"]))
            for calendar in feed["serviceCalendars"]:
                days = set(calendar["days"])
                calendar_rows.append((feed["feedId"], calendar["serviceId"],
                    *(day in days for day in ("monday", "tuesday", "wednesday", "thursday",
                                              "friday", "saturday", "sunday")),
                    calendar["startDate"], calendar["endDate"],
                    calendar["referencedByTrips"], calendar["expired"]))
            for line in feed["lines"]:
                frequency = line.get("frequency")
                if frequency:
                    frequency_rows.extend((line["routeId"], sequence, window["serviceId"],
                        window["startTime"], window["endTime"], window["headwaySeconds"])
                        for sequence, window in enumerate(frequency["windows"], 1))
        _executemany(connection, """
            INSERT INTO public.rail_feeds
              (feed_id, feed_name, agency, source_url, licence, licence_status,
               service_start, service_end) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, feed_rows)
        _executemany(connection, """
            INSERT INTO public.rail_service_calendars
              (feed_id, service_id, monday, tuesday, wednesday, thursday, friday,
               saturday, sunday, start_date, end_date, referenced_by_trips, expired)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, calendar_rows)
        _executemany(connection, """
            INSERT INTO public.rail_frequency_windows
              (route_id, window_sequence, service_id, start_time, end_time, headway_seconds)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, frequency_rows)

        stops = [(s["stopId"], s["name"], s["lat"], s["lon"], "BUS", "rapidkl-bus")
                 for s in bus_stops]
        stops.extend((s["stopId"], s["name"], s["lat"], s["lon"], "RAIL", rail_doc["feedId"])
                     for s in rail_doc["stations"])
        _executemany(connection, """
            INSERT INTO public.transit_stops
              (stop_id, name, latitude, longitude, mode, source)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (stop_id) DO UPDATE SET name=excluded.name,
              latitude=excluded.latitude, longitude=excluded.longitude,
              mode=excluded.mode, source=excluded.source, updated_at=now()
        """, stops)

        route_stops = []
        for service in registry["services"]:
            route_stops.extend((service["line_id"], stop["stop_id"], stop["stop_sequence"], -1)
                               for stop in service["stops"])
        _executemany(connection, """
            INSERT INTO public.route_stops (route_id, stop_id, stop_sequence, direction_id)
            VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
        """, route_stops)

        pattern_rows = []
        for route in patterns_doc["routes"]:
            for direction in route["directions"]:
                for stop in direction["stops"]:
                    pattern_rows.append((route["routeId"], direction["directionId"],
                        direction.get("tripHeadsign"), stop["sequence"], stop["stationId"],
                        stop.get("platformStopId"), stop.get("arrivalOffsetSeconds"),
                        stop.get("departureOffsetSeconds")))
        _executemany(connection, """
            INSERT INTO public.rail_pattern_stops
              (route_id, direction_id, trip_headsign, stop_sequence, station_id,
               platform_stop_id, arrival_offset_seconds, departure_offset_seconds)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, pattern_rows)

        shape_rows = []
        for route_id, shape in shapes_doc.items():
            for sequence, point in enumerate(shape["points"], 1):
                lat, lon = (point if isinstance(point, list) else (point["lat"], point["lon"]))
                shape_rows.append((route_id, shape["shapeId"], sequence, lat, lon))
        _executemany(connection, """
            INSERT INTO public.rail_shape_points
              (route_id, shape_id, point_sequence, latitude, longitude)
            VALUES (%s,%s,%s,%s,%s)
        """, shape_rows)

        _executemany(connection, """
            INSERT INTO public.places
              (place_id, name, kind, kind_label, latitude, longitude)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, ((p["placeId"], p["name"], p["kind"], p.get("kindLabel"), p["lat"], p["lon"])
               for p in places_doc["places"]))
        _executemany(connection, """
            INSERT INTO public.essential_services
              (service_id, name, source_category, latitude, longitude, address, hours, accessible)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, ((s["id"], s["name"], s["sourceCategory"], s["lat"], s["lon"],
                 s.get("address"), s.get("hours"), s.get("accessible"))
               for s in services_doc["services"]))

        metadata_rows = []
        for key, doc, count_key in (("places", places_doc, "placeCount"),
                                    ("essential_services", services_doc, "recordCount")):
            bbox = doc.get("bbox", {})
            metadata_rows.append((key, doc.get("generatedAt"), doc["source"],
                doc.get("licence"), doc.get(count_key), bbox.get("minLat"), bbox.get("maxLat"),
                bbox.get("minLon"), bbox.get("maxLon")))
        _executemany(connection, """
            INSERT INTO public.dataset_metadata
              (dataset_key, generated_at, source, licence, record_count,
               min_lat, max_lat, min_lon, max_lon)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, metadata_rows)


def _profile_rows(registry: dict, version: str) -> Iterator[tuple]:
    specs = (
        ("profiles", "stop_time", ("route_id", "stop_id", "hour", "weekend")),
        ("fallback_profiles", "stop", ("route_id", "stop_id")),
        ("route_profiles", "route", ("route_id", "hour", "weekend")),
        ("network_profiles", "network", ("hour", "weekend")),
    )
    for container, level, fields in specs:
        for key, profile in registry[container].items():
            values = dict(zip(fields, key.split("|")))
            yield (version, level, values.get("route_id"), values.get("stop_id"),
                   int(values["hour"]) if "hour" in values else None,
                   values.get("weekend") == "1" if "weekend" in values else None,
                   profile["sample_count"], profile["stop_sequence"],
                   profile["historical_mean_delay"], profile["historical_median_delay"],
                   profile["p25"], profile["p50"], profile["p75"],
                   profile.get("residual_scale"), key)


def import_model_registry(connection, artifact_uri: str | None = None) -> None:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    meta = registry["metadata"]
    version = meta["model_version"]
    with connection.transaction():
        connection.execute("DELETE FROM public.model_versions WHERE model_version=%s", (version,))
        connection.execute("""
            INSERT INTO public.model_versions
              (model_version, model_type, artifact_uri, training_start, training_end,
               validation_start, validation_end, test_start, test_end,
               baseline_mae, baseline_rmse, model_mae, model_rmse,
               arrival_validation_passed, candidate_for_promotion, prediction_enabled,
               label_method, validation_status, release_basis)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (version, meta["model_type"], artifact_uri, meta["training_start"],
              meta["training_end"], meta.get("validation_start"), meta.get("validation_end"),
              meta.get("test_start"), meta.get("test_end"), meta["baseline"]["mae"],
              meta["baseline"]["rmse"], meta["model"]["mae"], meta["model"]["rmse"],
              meta["arrival_validation_passed"], meta["candidate_for_promotion"],
              meta["prediction_enabled"], meta.get("label_method"),
              meta.get("validation_status"), meta.get("release_basis")))
        _executemany(connection, "INSERT INTO public.model_features VALUES (%s,%s,%s)",
                     ((version, i, name) for i, name in enumerate(meta["features"], 1)))
        _executemany(connection, "INSERT INTO public.model_scope_routes VALUES (%s,%s)",
                     ((version, route) for route in meta["scope"]))
        _executemany(connection, "INSERT INTO public.model_data_sources VALUES (%s,%s)",
                     ((version, source) for source in meta["data_sources"]))
        _copy_rows(connection, "reliability_profiles", (
            "model_version", "profile_level", "route_id", "stop_id", "hour",
            "is_weekend", "sample_count", "stop_sequence", "historical_mean_delay",
            "historical_median_delay", "p25", "p50", "p75", "residual_scale",
            "profile_key",
        ), _profile_rows(registry, version))


def _month_bounds(value: date) -> tuple[date, date]:
    start = value.replace(day=1)
    if value.month == 12:
        end = date(value.year + 1, 1, 1)
    else:
        end = date(value.year, value.month + 1, 1)
    return start, end


def _ensure_month_partitions(connection, table: str, dates: Iterable[date]) -> None:
    if table not in {"vehicle_observations", "stop_arrivals"}:
        raise ValueError("unsupported partitioned table")
    months = sorted({_month_bounds(value) for value in dates})
    from psycopg import sql

    for start, end in months:
        suffix = start.strftime("%Y_%m")
        connection.execute(sql.SQL(
            "CREATE TABLE IF NOT EXISTS public.{} PARTITION OF public.{} "
            "FOR VALUES FROM ({}) TO ({})"
        ).format(sql.Identifier(f"{table}_{suffix}"), sql.Identifier(table),
                 sql.Literal(start), sql.Literal(end)))
    connection.commit()


PARQUET_TARGETS = {
    "observations": ("vehicle_observations",
        ("service_date", "timestamp", "trip_id", "route_id", "vehicle_id", "latitude",
         "longitude", "speed", "start_time"),
        ("service_date", "observed_at", "trip_id", "route_id", "vehicle_id", "latitude",
         "longitude", "speed", "start_time")),
    "arrivals": ("stop_arrivals",
        ("service_date", "route_id", "trip_id", "vehicle_id", "start_time", "stop_id",
         "stop_sequence", "scheduled_arrival", "actual_arrival", "delay_seconds",
         "arrival_match_quality", "quality_reason", "match_confidence", "training_eligible"),
        ("service_date", "route_id", "trip_id", "vehicle_id", "start_time", "stop_id",
         "stop_sequence", "scheduled_arrival", "actual_arrival", "delay_seconds",
         "arrival_match_quality", "quality_reason", "match_confidence", "training_eligible")),
    "features": ("reliability_features",
        ("route_id", "stop_id", "stop_sequence", "service_date", "scheduled_arrival", "hour",
         "day_of_week", "is_weekend", "scheduled_headway", "previous_stop_delay",
         "historical_median_delay", "historical_mean_delay", "target_delay_minutes"),
        ("route_id", "stop_id", "stop_sequence", "service_date", "scheduled_arrival", "hour",
         "day_of_week", "is_weekend", "scheduled_headway", "previous_stop_delay",
         "historical_median_delay", "historical_mean_delay", "target_delay_minutes")),
}


def import_parquet(connection, kind: str, paths: Sequence[str], model_version: str = MODEL_VERSION,
                   batch_size: int = 50_000) -> int:
    try:
        import pyarrow.dataset as ds
    except ImportError as exc:
        raise RuntimeError("pyarrow is required for Parquet imports") from exc
    table, source_columns, target_columns = PARQUET_TARGETS[kind]
    dataset = ds.dataset(list(paths), format="parquet")
    scanner = dataset.scanner(columns=list(source_columns), batch_size=batch_size)
    if table in {"vehicle_observations", "stop_arrivals"}:
        unique_dates: set[date] = set()
        for fragment in dataset.get_fragments():
            values = fragment.to_table(columns=["service_date"])["service_date"].unique().to_pylist()
            unique_dates.update(value for value in values if value is not None)
        _ensure_month_partitions(connection, table, unique_dates)
    columns = list(target_columns)
    if kind == "features":
        columns.insert(0, "model_version")
    copy_sql = f"COPY public.{table} ({', '.join(columns)}) FROM STDIN"
    count = 0
    with connection.cursor() as cursor:
        with cursor.copy(copy_sql) as copy:
            for batch in scanner.to_batches():
                for row in batch.to_pylist():
                    values = tuple(row[column] for column in source_columns)
                    copy.write_row(((model_version,) + values) if kind == "features" else values)
                    count += 1
    connection.commit()
    return count


def _expand_paths(values: Sequence[str]) -> list[str]:
    paths: list[str] = []
    for value in values:
        candidate = Path(value)
        if candidate.exists():
            if candidate.is_dir():
                paths.extend(str(p) for p in sorted(candidate.glob("*.parquet")))
            else:
                paths.append(str(candidate))
        else:
            parent = candidate.parent if str(candidate.parent) else Path(".")
            paths.extend(str(p) for p in sorted(parent.glob(candidate.name)))
    if not paths:
        raise FileNotFoundError("No Parquet files matched the supplied paths")
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate TransitReach data to PostgreSQL")
    parser.add_argument("--database-url", help="Defaults to DATABASE_URL")
    parser.add_argument("--apply-schema", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("reference", help="Import stops, routes, places and services")
    registry = sub.add_parser("registry", help="Import model metadata and profiles")
    registry.add_argument("--artifact-uri", help="Supabase Storage URI for the .cbm model")
    parquet = sub.add_parser("parquet", help="Stream Parquet rows with PostgreSQL COPY")
    parquet.add_argument("kind", choices=PARQUET_TARGETS)
    parquet.add_argument("paths", nargs="+")
    parquet.add_argument("--model-version", default=MODEL_VERSION)
    parquet.add_argument("--batch-size", type=int, default=50_000)
    sub.add_parser("core", help="Import reference data and model registry")
    args = parser.parse_args()

    with _connect(args.database_url) as connection:
        if args.apply_schema:
            apply_schema(connection)
        if args.command in {"reference", "core"}:
            import_reference_data(connection)
        if args.command in {"registry", "core"}:
            import_model_registry(connection, getattr(args, "artifact_uri", None))
        if args.command == "parquet":
            paths = _expand_paths(args.paths)
            count = import_parquet(connection, args.kind, paths, args.model_version, args.batch_size)
            print(f"Imported {count:,} rows into {PARQUET_TARGETS[args.kind][0]}")


if __name__ == "__main__":
    main()
