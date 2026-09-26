from __future__ import annotations

from collections import defaultdict

from backend.app.database import connection


EPIC_LINES = {
    "KJ": "LRT Kelana Jaya", "AG": "LRT Ampang", "PH": "LRT Sri Petaling",
    "SA": "LRT Shah Alam", "KGL": "MRT Kajang", "PYL": "MRT Putrajaya",
    "MR": "KL Monorail", "BRT": "BRT Sunway",
}


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def application_data() -> dict:
    """Build the browser bootstrap payload exclusively from PostgreSQL."""
    with connection() as database:
        routes = database.execute("""
            select route_id, short_name, long_name, mode, colour
            from public.transit_routes where mode <> 'BUS' order by route_id
        """).fetchall()
        frequency_rows = database.execute("""
            select route_id, service_id, start_time, end_time, headway_seconds
            from public.rail_frequency_windows order by route_id, window_sequence
        """).fetchall()
        frequencies: dict[str, list[dict]] = defaultdict(list)
        for row in frequency_rows:
            frequencies[row["route_id"]].append({
                "serviceId": row["service_id"], "startTime": row["start_time"],
                "endTime": row["end_time"], "headwaySeconds": row["headway_seconds"],
            })

        stop_counts = {row["route_id"]: row["count"] for row in database.execute("""
            select route_id, count(distinct station_id)::int as count
            from public.rail_pattern_stops group by route_id
        """)}
        lines = []
        for route in routes:
            windows = frequencies.get(route["route_id"], [])
            headways = [window["headwaySeconds"] for window in windows]
            lines.append({
                "routeId": route["route_id"], "shortName": route["short_name"] or route["route_id"],
                "longName": route["long_name"], "mode": route["mode"],
                "color": route["colour"] or "#64748b",
                "stopCount": stop_counts.get(route["route_id"], 0),
                "frequency": ({"minHeadwaySeconds": min(headways),
                               "maxHeadwaySeconds": max(headways), "windows": windows}
                              if headways else None),
            })

        feeds = []
        for feed in database.execute("select * from public.rail_feeds order by feed_id"):
            calendars = []
            for calendar in database.execute("""
                select * from public.rail_service_calendars
                where feed_id=%s order by service_id
            """, (feed["feed_id"],)):
                days = [day for day in ("monday", "tuesday", "wednesday", "thursday",
                                        "friday", "saturday", "sunday") if calendar[day]]
                calendars.append({
                    "serviceId": calendar["service_id"], "days": days,
                    "startDate": calendar["start_date"].strftime("%Y%m%d"),
                    "endDate": calendar["end_date"].strftime("%Y%m%d"),
                    "referencedByTrips": calendar["referenced_by_trips"],
                    "expired": calendar["expired"],
                })
            feeds.append({
                "feedId": feed["feed_id"], "feedName": feed["feed_name"],
                "agency": feed["agency"], "source": feed["source_url"],
                "licence": feed["licence"], "licenceStatus": feed["licence_status"],
                "serviceDateRange": {"start": feed["service_start"].strftime("%Y%m%d"),
                                     "end": feed["service_end"].strftime("%Y%m%d")},
                "serviceCalendars": calendars, "lines": lines,
            })

        memberships: dict[str, dict[str, set[str]]] = defaultdict(
            lambda: {"lines": set(), "platforms": set()})
        for row in database.execute("""
            select route_id, station_id, platform_stop_id from public.rail_pattern_stops
        """):
            memberships[row["station_id"]]["lines"].add(row["route_id"])
            if row["platform_stop_id"]:
                memberships[row["station_id"]]["platforms"].add(row["platform_stop_id"])
        rail_stops = [{
            "stopId": row["stop_id"], "name": row["name"], "lat": row["latitude"],
            "lon": row["longitude"], "lines": sorted(memberships[row["stop_id"]]["lines"]),
            "platforms": sorted(memberships[row["stop_id"]]["platforms"]),
        } for row in database.execute("""
            select stop_id, name, latitude, longitude from public.transit_stops
            where mode='RAIL' order by name, stop_id
        """)]
        bus_stops = [{
            "stopId": row["stop_id"], "name": row["name"], "lat": row["latitude"],
            "lon": row["longitude"], "distanceToAccessibleStationMeters": None,
        } for row in database.execute("""
            select stop_id, name, latitude, longitude from public.transit_stops
            where mode='BUS' order by name, stop_id
        """)]
        places = [{
            "placeId": row["place_id"], "name": row["name"], "kind": row["kind"],
            "kindLabel": row["kind_label"], "lat": row["latitude"], "lon": row["longitude"],
        } for row in database.execute("select * from public.places order by name, place_id")]
        services = [{
            "id": row["service_id"], "name": row["name"], "sourceCategory": row["source_category"],
            "lat": row["latitude"], "lon": row["longitude"], "address": row["address"],
            "hours": row["hours"], "accessible": row["accessible"],
        } for row in database.execute("select * from public.essential_services order by name, service_id")]

        patterns: dict[str, dict[int, dict]] = defaultdict(dict)
        for row in database.execute("""
            select * from public.rail_pattern_stops
            order by route_id, direction_id, stop_sequence
        """):
            direction = patterns[row["route_id"]].setdefault(row["direction_id"], {
                "directionId": row["direction_id"], "tripHeadsign": row["trip_headsign"], "stops": []})
            direction["stops"].append({
                "stationId": row["station_id"], "platformStopId": row["platform_stop_id"],
                "sequence": row["stop_sequence"],
                "arrivalOffsetSeconds": row["arrival_offset_seconds"],
                "departureOffsetSeconds": row["departure_offset_seconds"],
            })
        pattern_list = [{"routeId": route_id, "directions": list(directions.values())}
                        for route_id, directions in sorted(patterns.items())]

        shapes: dict[str, dict] = {}
        for row in database.execute("""
            select * from public.rail_shape_points order by route_id, shape_id, point_sequence
        """):
            shape = shapes.setdefault(row["route_id"], {"shapeId": row["shape_id"], "points": []})
            shape["points"].append({"lat": row["latitude"], "lon": row["longitude"]})

        metadata = {row["dataset_key"]: row for row in database.execute(
            "select * from public.dataset_metadata")}
        extent = {
            "minLat": min(stop["lat"] for stop in rail_stops),
            "maxLat": max(stop["lat"] for stop in rail_stops),
            "minLon": min(stop["lon"] for stop in rail_stops),
            "maxLon": max(stop["lon"] for stop in rail_stops),
        }
        service_meta = metadata["essential_services"]
        place_meta = metadata["places"]
        return {
            "railStops": rail_stops, "busStops": bus_stops, "places": places,
            "essentialServices": services, "railPatterns": pattern_list, "railShapes": shapes,
            "railMetadata": {
                "feeds": feeds,
                "epicLineCoverage": [{"label": label, "routeId": route_id,
                                      "present": any(line["routeId"] == route_id for line in lines)}
                                     for route_id, label in EPIC_LINES.items()],
                "modesNotLoaded": ["KTM Komuter", "ERL"],
                "studyAreaFeedExtent": extent, "notes": [], "warnings": [],
            },
            "placesMetadata": {"generatedAt": _iso(place_meta["generated_at"]),
                "source": place_meta["source"], "licence": place_meta["licence"],
                "placeCount": place_meta["record_count"]},
            "servicesMetadata": {"generatedAt": _iso(service_meta["generated_at"]),
                "source": service_meta["source"], "licence": service_meta["licence"],
                "recordCount": service_meta["record_count"],
                "bbox": {"minLat": service_meta["min_lat"], "maxLat": service_meta["max_lat"],
                         "minLon": service_meta["min_lon"], "maxLon": service_meta["max_lon"]}},
        }
