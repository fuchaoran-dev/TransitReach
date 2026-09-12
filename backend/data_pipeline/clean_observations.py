from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from .config import CleaningConfig


REQUIRED_COLUMNS = ("timestamp", "trip_id", "route_id", "vehicle_id", "latitude", "longitude", "speed", "start_time")


def _sql_literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def clean_with_duckdb(raw_glob: str, output: Path, config: CleaningConfig) -> None:
    """Parquet-to-Parquet filtering without materialising the dataset in RAM."""
    config.validate()
    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("Install backend/requirements.txt before running the pipeline") from exc

    output.parent.mkdir(parents=True, exist_ok=True)
    routes = ", ".join(_sql_literal(route_id) for route_id in config.route_ids)
    raw_source = _sql_literal(raw_glob)
    destination = _sql_literal(output)
    reader = (
        f"read_csv_auto({raw_source}, all_varchar = true, union_by_name = true)"
        if ".csv" in raw_glob.lower()
        else f"read_parquet({raw_source}, hive_partitioning = true)"
    )
    query = f"""
        COPY (
          WITH typed AS (
            SELECT
              coalesce(
                epoch_ms(try_cast(timestamp AS BIGINT) * 1000),
                try_cast(timestamp AS TIMESTAMP)
              ) AS timestamp,
              trip_id, route_id, vehicle_id, start_time,
              try_cast(latitude AS DOUBLE) AS latitude,
              try_cast(longitude AS DOUBLE) AS longitude,
              try_cast(speed AS DOUBLE) AS speed
            FROM {reader}
          ), scoped AS (
            SELECT *,
              CAST(timestamp + INTERVAL 8 HOUR AS DATE) AS service_date,
              epoch(timestamp)::BIGINT // {config.sample_seconds} AS sample_bucket
            FROM typed
            WHERE CAST(timestamp + INTERVAL 8 HOUR AS DATE) >= {_sql_literal(config.start_date)}::DATE
              AND CAST(timestamp + INTERVAL 8 HOUR AS DATE) < {_sql_literal(config.end_date)}::DATE
              AND route_id IN ({routes})
              AND trip_id IS NOT NULL AND vehicle_id IS NOT NULL
              AND length(trim(trip_id)) > 0 AND length(trim(vehicle_id)) > 0
              AND latitude IS NOT NULL AND longitude IS NOT NULL
              AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
          ), ranked AS (
            SELECT *, row_number() OVER (
              PARTITION BY service_date, trip_id, vehicle_id, start_time, sample_bucket
              ORDER BY timestamp
            ) AS observation_rank FROM scoped
          )
          SELECT service_date, timestamp, trip_id, route_id, vehicle_id,
                 latitude, longitude, speed, start_time
          FROM ranked WHERE observation_rank = 1
          ORDER BY service_date, route_id, trip_id, vehicle_id, timestamp
        ) TO {destination} (FORMAT PARQUET, COMPRESSION ZSTD)
    """
    connection = duckdb.connect()
    try:
        connection.execute(query)
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Filter and downsample GTFS-RT Parquet safely")
    parser.add_argument("--input", required=True, help="Parquet path/glob")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", required=True, type=date.fromisoformat)
    parser.add_argument("--routes", required=True, nargs="+")
    parser.add_argument("--sample-seconds", type=int, default=30)
    args = parser.parse_args()
    clean_with_duckdb(args.input, args.output, CleaningConfig(
        args.start, args.end, tuple(args.routes), args.sample_seconds
    ))


if __name__ == "__main__":
    main()
