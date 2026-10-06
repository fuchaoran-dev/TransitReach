# Desktop UI / Epic 7 review — 2026-10-03

Scope: current map, service selection, journey inspection, departure comparison,
weather, desktop presentation and deployment. No mobile interactions, new Epic 2
optimizer, new Epic 8 implementation, database writes or Git push.

## Fixes

- Invalidate service coverage and on-demand estimates when origin is cleared,
  disabled, changed or unmounted. Ignore aborted late coverage/estimate responses.
- Reset journey/leg/step focus on departure, destination, budget, retry or tab changes.
- Close the 3D surface when the last location is cleared.
- Include style downloads in the vector fallback deadline and abort obsolete downloads.
- Apply the major-road label filter to symbol layers, restoring the simplified map.
- Show baseline-only, selected-only and overlap polygons in native 3D as well as 2D.
- Keep weather during background refresh; failed refresh explicitly becomes Unknown.
- Validate forecast payloads, deduplicate dates, reject malformed temperatures/periods,
  and prioritize thunderstorm warnings in mixed descriptions.
- Update the seven-day supported-date window across midnight and disable unusable presets.
- Preserve existing production Meet Supabase browser configuration during local builds.
- Apply compatible updates to ws, brace-expansion and PostCSS; production dependency
  audit reports zero known findings after these patches.

## Automated verification

- TypeScript check and production build pass.
- ESLint: zero errors; existing dependency/fast-refresh warnings remain.
- 40 arrival/3D scene checks, 29 weather/parser checks, 32 React lifecycle checks.
- 20 backend unittest checks.
- Fixture tests do not claim to validate live weather or every device/GPU.
- No database connection strings detected in generated browser assets.

## Pre-deployment live checks

- Render health: HTTP 200, status ok.
- Netlify PostgreSQL bootstrap proxy: HTTP 200; 162 rail stops, 4,053 bus stops,
  3,020 places and 19,406 essential-service records.
- Official Kuala Lumpur weather proxy: HTTP 200, seven forecast rows.
- Routing isochrones: HTTP 200, valid MultiPolygon responses for October 4 at
  09:00 MYT and October 5 at 18:00 MYT.

## Remaining qualifications

- Existing development/build dependency audit findings remain after compatible patches;
  upgrading Vite/Tailwind across major versions requires separate compatibility work.
- Large-chunk and Browserslist freshness warnings remain non-blocking build warnings.
- OSM opening hours may be missing; weather is regional advisory data and does not
  claim calibrated weather-adjusted travel times.
- Availability is a point-in-time check, not a guarantee of upstream uptime.

## Final production deployment

- Netlify deployment: `6ac107ff7c75c3c4e079f807`.
- URL: https://transitreach-kl-fuchaorantransitreach.netlify.app/
- Homepage, bootstrap, official weather and reliability-service proxies return HTTP 200.
- Online entry JS/CSS, App bundle and MapLibre worker match the local build SHA-256.
- Native Chrome: map and compact forecast render; SunU-Monash search/selection works;
  30-minute result is 13.6 km² with 515 services and three hospital records.
- Selecting Sunway Medical Centre opens 3D while retaining the origin. Journey preview
  and detail draw the BRT/walking route and distinct origin/destination points.
- The modelled journey is four minutes (two BRT, two walking); unknown opening hours
  remain Unknown, not assumed open. Alternative walking journey is fifteen minutes.
- Browser window became unavailable before the final clear-button click check. Clear,
  stale-response and date-change behaviour is covered by the React regression fixtures;
  do not interpret this record as exhaustive manual end-to-end coverage.
- Render application code/configuration was unchanged; its health check passed.
- No Git commit or push was performed; local HEAD remains `92894d3`.
