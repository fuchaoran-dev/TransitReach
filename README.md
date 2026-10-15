TransitReach

Production website: [transitreach-kl-team8.netlify.app](https://transitreach-kl-team8.netlify.app/).
The Netlify project was renamed on 14 October 2026; see
[domain-change notes](docs/domain-change.md) for invitation and anonymous-session impact.

## Group invitations and personal passes

The local automatic-Ready/map/PNG revision is described in
[meeting experience](docs/meeting-experience.md). It is not deployed yet and requires
`supabase/meeting-auto-planning.sql` after the existing voting migration.

MD8-6 adds confirmed group meetings, private arrive-by passes, device storage,
room invitation QR codes and image downloads. Service setup, privacy boundaries
and verification are documented in [docs/group-passes.md](docs/group-passes.md).

## Epic 7 reliability

The AI transit reliability feature has a separate FastAPI service and a data-gated ML
pipeline. Setup, data provenance, training commands, current service capabilities and
acceptance-criteria coverage are documented in [`backend/README.md`](backend/README.md).
# Epic 5 data and routing

The Essential Services page uses a reproducible extract of real OpenStreetMap POIs in the
Klang Valley study area. Refresh the migration source sparingly with:

```bash
npm run data:essential-services
```

The generated file `src/shared/data/services/services.json` is an ingestion source only.
Production application data is stored in Supabase PostgreSQL and served by FastAPI through
`/api/data/bootstrap`. OSM tags are mapped by the documented rules in
`src/features/essential-services/serviceDataRules.ts`, and nearby same-name node/way records
are deduplicated before counting.

Travel-time reachability and per-service journey estimates are calculated by the project's
OpenTripPlanner instance from the OSM street graph and the Prasarana Rapid Rail KL GTFS
schedule. The Time page sends the same request twice with separate departure times (09:00
and 17:00), then counts the same OSM records inside each OTP isochrone. The current feed is
static rail data; bus/feeder and realtime data are not included.
