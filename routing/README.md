# Routing engine — OpenTripPlanner

Epic 1 needs a reachable area computed over a **real street network**. The Definition of
Done forbids substituting straight-line distance in any walking component, and forbids a
third-party routing service receiving a user's device coordinate. A self-hosted
OpenTripPlanner satisfies both: it routes over the real OSM pedestrian network, and it is
our service rather than someone else's.

Nothing in `routing/` is part of the web build. The React app talks to OTP over HTTP.

## What is committed and what is not

Committed: the three `*-config.json` files and this README.

Not committed (large, and reproducible from the commands below): the OTP jar, the OSM
extract, the GTFS copy, and the built `graph.obj`.

## Setup from scratch

### 1. Java

OTP 2.5.0's own docs ask for **Java 17 or later**. We run it on **Temurin 25** (an LTS),
which works and is what is installed — the JVM is backwards compatible with 2.5.0's
bytecode. If you hit a JVM-related failure, Temurin 17 or 21 are the documented fallbacks.

```powershell
winget install --id EclipseAdoptium.Temurin.25.JDK --source winget
```

Open a **new** terminal afterwards, then confirm:

```
java -version     # must report 25.x
```

### 2. Download the engine and the street network

Run these from `routing/otp/`.

> ### Use OTP 2.5.0. Do not upgrade.
>
> This is the most important thing on the page. **OTP has no isochrone endpoint after
> 2.5.0.** Isochrones live in the TravelTime sandbox, which was removed in 2.6.0 — the
> `sandbox/TravelTime/` documentation page returns 200 for versions 2.2.0 through 2.5.0
> and 404 from 2.6.0 onward.
>
> This was verified the hard way: 2.9.0 was installed and a graph built before the
> endpoint 404'd. Running 2.9.0 with `SandboxAPITravelTime` set logs
> `The enum value 'SandboxAPITravelTime' is not legal`, and no isochrone route is
> registered at any path. Epic 1 is entirely about drawing a reachable area, so an OTP
> without isochrones is of no use to us.
>
> If someone upgrades this and the map stops drawing areas, this is why.

Note the artifact rename: it is `otp` up to 2.6.0 and `otp-shaded` from 2.7.0. Since we
are on 2.5.0, the file is `otp-2.5.0-shaded.jar`. GitHub releases stopped attaching jars
after 2.6.0, so Maven Central is the source either way.

```bash
curl -L -o otp-2.5.0-shaded.jar \
  https://repo1.maven.org/maven2/org/opentripplanner/otp/2.5.0/otp-2.5.0-shaded.jar

curl -L -o malaysia-singapore-brunei-latest.osm.pbf \
  https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
```

Expect roughly 174 MB and 238 MB. Check both before building — a truncated PBF fails the
graph build with an unhelpful error. The jar should start with the bytes `PK`, and the PBF
should contain `OSMHeader` in its first 20 bytes.

A `graph.obj` is tied to the OTP version that wrote it (2.5.0 and 2.9.0 use different
serialisation version ids). Changing OTP version means rebuilding the graph.

Geofabrik publishes **no sub-region extract for Malaysia**, so this is the whole country
plus Singapore and Brunei. See "Clipping" below.

### 3. Expand the GTFS feed

Do **not** hand OTP the raw feed. Run this from the repo root:

```bash
node scripts/expand-gtfs-frequencies.mjs
```

It writes `routing/otp/gtfs-rapid-rail-kl-expanded/`, which is what `build-config.json`
points at. If `data/gtfs/` is empty, re-download the feed first — see
`scripts/build-rail-stops.mjs`.

> ### Why the feed is expanded
>
> The Prasarana rail feed publishes **no timetable at all**. Every trip is a headway in
> `frequencies.txt`, which OTP reports at build time as:
>
> ```
> Added 106 frequency-based and 0 single-trip timetable entries.
> ```
>
> Expanding those windows into concrete trips measurably improves the result. Measured
> from Kwasa Damansara, 60 min, `modes=WALK,SUBWAY`:
>
> | Feed | Reachable area |
> |---|---|
> | Frequency-based (raw) | ~104 km² |
> | Expanded to scheduled | ~135 km² |
>
> Transit routing works either way — the expansion is an improvement, not a repair. It is
> kept because a ~30% difference in reachable area is not a rounding error, and because
> Raptor's `BEST_TIME` profile (which the TravelTime sandbox uses) handles explicit
> departures better than frequency windows.
>
> `scripts/expand-gtfs-frequencies.mjs` materialises each frequency window at the feed's
> own published headway. `exact_times` is absent from `frequencies.txt` (so 0), which is
> exactly the case GTFS permits to be expanded this way. 48 template trips become 7,329
> scheduled trips. Nothing is invented.
>
> **The clock times this produces are an artefact of expansion, not published departures.**
> The Epic 1 DoD requires that no clock time is ever presented as a scheduled departure.
> They exist only so the router can compute durations — never display them.

### 3a. How to tell if transit is actually working

Do this after any change to the engine, the feed or the config. Walking-only isochrones
look entirely reasonable on their own, so you cannot eyeball it.

> **`modes=WALK` vs `modes=WALK,TRANSIT` is NOT a valid test.** Both produce an *empty*
> transit-mode filter, which OTP treats as "no restriction" — so both include transit and
> return byte-identical output. This looks exactly like transit being broken, and it cost
> a long detour to work out. Do not repeat it.

Use a mode that exists in the feed against one that does not. Every route here is
`SUBWAY` except BRT Sunway, which is `TRAM` — **no route is `RAIL`**, so `WALK,RAIL` is a
genuine walking-only baseline:

```bash
# walking only (RAIL matches no route in this feed)
curl -s ".../isochrone?location=3.176146,101.572052&...&modes=WALK,RAIL&cutoff=60M"
# with the 7 rail lines
curl -s ".../isochrone?location=3.176146,101.572052&...&modes=WALK,SUBWAY&cutoff=60M"
```

Expected from Kwasa Damansara at 60 min:

| modes | regions | area | span |
|---|---|---|---|
| `WALK,RAIL` | 1 | ~13 km² | 5.7 × 4.7 km |
| `WALK,SUBWAY` | 11 | ~135 km² | 20.7 × 21.5 km |
| `WALK,TRAM` | 1 | ~13 km² | 5.7 × 4.7 km |

Two independent sanity checks are built into that table. Walking 60 min at 1.33 m/s
reaches 4.8 km, so a walking-only span **cannot** exceed about 10 km — the 20.7 km span
is only reachable by rail. And `WALK,TRAM` correctly collapses to the walking baseline,
because Kwasa Damansara is nowhere near the BRT Sunway line.

Do **not** use a `plan` query as the check: it uses a different Raptor profile and will
happily return a rail itinerary even when the isochrone path is misconfigured.

### 4. Build the graph

```bash
java -Xmx12G -jar otp-2.5.0-shaded.jar --build --save .
```

### 5. Serve

```bash
java -Xmx8G -jar otp-2.5.0-shaded.jar --load .
```

OTP listens on `http://localhost:8080`.

## Configuration

### `otp-config.json`

Isochrones are **not** exposed by default. They come from the TravelTime sandbox feature,
which this file enables:

```json
{ "otpFeatures": { "SandboxAPITravelTime": true } }
```

That gives `/otp/traveltime/isochrone` (GeoJSON boundaries at a cutoff) and
`/otp/traveltime/surface` (a GeoTIFF raster). The app uses the isochrone endpoint.

### `build-config.json`

`transitServiceStart: "-P1M"` and `transitServiceEnd: "P1Y"` bound the service period
relative to the build date. This is how the DoD's "expired service periods are never used
for a computation" is enforced at the engine, not just described in the interface. The
feed's live calendars (`MonFri`, `Sat`, `Sun`) run to 2026-12-31; its expired `weekday`
and `weekend` calendars ended 2026-03-31 and are referenced by no trip.

The OSM and GTFS inputs are listed explicitly rather than relying on OTP's filename
auto-scan, so the GTFS file does not have to be renamed to contain "gtfs".

### `router-config.json`

```json
{ "routingDefaults": { "walk": { "speed": 1.33 } } }
```

**1.33 m/s (about 4.8 km/h)** is OTP's documented default walking speed.

This value is not an implementation detail. AC 1.2.3 requires the walking speed used to be
**stated in the interface**, so if you change it here you must change what the app
displays. Do not let the two drift apart.

## Related: the searchable place set

Not part of the routing engine, but the second upstream data dependency this project has,
and it must be reproducible the same way.

`scripts/build-places.mjs` fetches named Klang Valley places — suburbs, towns, malls,
hospitals, universities, attractions, airports — from the **Overpass API**, and writes
`src/shared/data/places/places.json`, which **is committed**.

```bash
node scripts/build-places.mjs
```

Run it manually, sanity-check the per-kind counts it prints, and commit the result. It is
not wired into `npm run build`, and must not be put in CI: Overpass is a shared public
service.

**Why it exists.** Mentors asked why only stations could be searched. The obvious answer —
call a geocoder as the user types — is forbidden by AC 1.1.3 and by the Epic 1 DoD line
"No geocoding endpoint is called by the application". Doing the lookup once here, at build
time, and shipping the result satisfies both: the application calls nothing, and named
places are still searchable. It is also faster (no network in the path), has no rate limit
to respect, and sends no user's query to a third party.

The output is OpenStreetMap-derived and therefore ODbL, like the tiles. The attribution
Leaflet already displays covers it.

Two notes for whoever re-runs it:
- Overpass answers **406** to a request with no `User-Agent`. The script sets one; do not
  remove it.
- A 429 or 504 means the shared endpoint is busy. Wait a few minutes rather than retrying
  in a loop.

## Known gaps

- **Hosting is unresolved, and is now the critical path.** Netlify serves a static build,
  so the deployed site cannot reach OTP on `localhost`. The DoD requires every criterion
  to pass on the *deployed* application, and OTP needs roughly 2–4 GB RAM — above every
  free tier. This needs an owner.

  **Precomputed polygons were considered as a way to avoid hosting, and rejected.**
  Measured: all 162 stations × 4 budgets = 648 polygons, 11 MB raw / 3 MB gzipped, about
  5 KB gzip each — cheap enough to ship statically, and it would turn OTP into a
  build-time tool with no server at all. It was rejected because AC 1.1.2 states that
  *"any in-area coordinate is a valid origin"* and precomputed station polygons cannot
  serve an arbitrary map click or a device location, so it would regress two criteria
  that are already built and verified. Epic 6 (meeting points from several arbitrary
  origins) would also become impossible.

  Covering arbitrary origins with a precomputed grid is not viable either: the study area
  is ~4,380 km², so a 1 km grid is ~17,500 polygons (~86 MB gzip) with 1 km of snapping
  error against a 15-minute isochrone only ~2 km across; a 500 m grid is ~343 MB.

  Note that precomputation is **not** a performance argument — live responses are
  32–932 ms. Its only real benefit is removing the hosting dependency.
- **Clipping.** A full-country graph is far larger than the study area needs. A custom
  bbox extract from <https://extract.bbbike.org/> covering roughly lat 2.79–3.37,
  lon 101.31–101.93 would cut the input to about 40–60 MB. Not needed locally; likely
  mandatory before hosting.
- **Rail only.** The bus and feeder-bus feeds are not loaded, so the engine computes
  rail-only reachability. The app must keep saying so on every result it affects.
- **Departure time is unowned.** OTP requires one for any transit search, and Epics 1, 2,
  5, 6 and 8 must all use the same default or their numbers will not reconcile.
