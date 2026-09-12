from __future__ import annotations

from pathlib import Path


def build_feature_table(
    stop_arrivals: Path,
    output: Path,
    eligible_routes: set[str] | None = None,
) -> dict[str, int]:
    """Build features using only information available before each target event."""
    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("Install backend/requirements.txt") from exc
    output.parent.mkdir(parents=True, exist_ok=True)
    source = str(stop_arrivals).replace("'", "''")
    destination = str(output).replace("'", "''")
    route_filter = ""
    if eligible_routes:
        route_values = ", ".join(
            f"'{route_id.replace(chr(39), chr(39) * 2)}'" for route_id in sorted(eligible_routes)
        )
        route_filter = f" AND route_id IN ({route_values})"
    query = f"""
      COPY (
        WITH eligible AS (
          SELECT *,
            extract(hour FROM scheduled_arrival)::INTEGER AS hour,
            extract(isodow FROM scheduled_arrival)::INTEGER AS day_of_week,
            extract(isodow FROM scheduled_arrival) IN (6, 7) AS is_weekend,
            delay_seconds / 60.0 AS target_delay_minutes,
            lag(delay_seconds / 60.0) OVER (
              PARTITION BY service_date, trip_id, vehicle_id, start_time
              ORDER BY stop_sequence
            ) AS previous_stop_delay
          FROM read_parquet('{source}') WHERE training_eligible{route_filter}
        )
        SELECT
          route_id, stop_id, stop_sequence, service_date, scheduled_arrival,
          hour, day_of_week, is_weekend,
          NULL::DOUBLE AS scheduled_headway,
          previous_stop_delay,
          median(target_delay_minutes) OVER (
            PARTITION BY route_id, stop_id, hour, is_weekend ORDER BY scheduled_arrival
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS historical_median_delay,
          avg(target_delay_minutes) OVER (
            PARTITION BY route_id, stop_id, hour, is_weekend ORDER BY scheduled_arrival
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS historical_mean_delay,
          target_delay_minutes
        FROM eligible ORDER BY scheduled_arrival
      ) TO '{destination}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """
    connection = duckdb.connect()
    try:
        connection.execute(query)
        count = connection.execute(f"SELECT count(*) FROM read_parquet('{destination}')").fetchone()[0]
    finally:
        connection.close()
    return {"rows": count}
