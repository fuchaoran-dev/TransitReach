TransitReach
# Epic 5 data and routing

The Essential Services page uses a committed, reproducible extract of real OpenStreetMap
POIs in the Klang Valley study area. Refresh it sparingly with:

```bash
npm run data:essential-services
```

The generated file is `src/shared/data/services/services.json`. OSM tags are mapped by the
documented rules in `src/features/essential-services/serviceDataRules.ts`, and nearby
same-name node/way records are deduplicated before counting.

Travel-time reachability and per-service journey estimates are calculated by the project's
OpenTripPlanner instance from the OSM street graph and the Prasarana Rapid Rail KL GTFS
schedule. The Time page sends the same request twice with separate departure times (09:00
and 17:00), then counts the same OSM records inside each OTP isochrone. The current feed is
static rail data; bus/feeder and realtime data are not included.
