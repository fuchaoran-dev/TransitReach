# Meeting and travel pass presentation · 15 October 2026

This revision updates local source only. It does not publish a Netlify/Render build,
apply a migration, write a real room or run model training.

## Travel pass

- Both pass views use the same vertical itinerary: compact dotted walking legs,
  route-coloured transit legs, readable stop names and separate stop-code chips.
- The meeting pass shows a live departure countdown and compares estimated arrival
  with the agreed meeting. Times remain planning estimates.
- Visible route cards compare duration, transfers and walking distance. Labels identify
  the fastest and least-walking alternatives when the options actually differ.
- The desktop route map stays visible while the itinerary scrolls. Below 1024px the map
  fills the dialog behind an expandable bottom sheet; route bounds account for the
  sheet so endpoints remain visible.
- PNG downloads use a ticket-style summary, a vertical timeline and a larger room-code
  footer with the invitation QR. The route sketch uses recorded geometry only and is
  explicitly labelled as a schematic. Long English/CJK names expand the layout.
- Stop counts appear only when OTP supplies a valid intermediate-stop list. The client
  requests `showIntermediateStops=true`; the count includes the final alighting stop.
  Older passes with no count omit it. Mode presentation prefers OTP's GTFS `routeType`
  over route-name text. The version-specific source is
  [OTP 2.5 ApiLeg](https://github.com/opentripplanner/OpenTripPlanner/blob/v2.5.0/src/ext/java/org/opentripplanner/ext/restapi/model/ApiLeg.java).

## Meet

Nearby venue pins cluster and expand on zoom. Pins show place-category glyphs;
selected and confirmed places retain a name label. Member avatars and map points use
consistent colours. Success states use green, while primary actions retain teal.
The top map status is compact, room sharing presents the readable room code with
copy/QR controls, and the members/settings panel can collapse on smaller displays.

The common-ground response adds `participantAreas[].memberId` and
`proposals[].participantTrips: [{memberId, minutes}]`. These IDs are existing public
participant-row IDs, never authentication user IDs. Durations come from the existing
arrive-by verification for each candidate. They are not reconstructed from the longest
trip or the travel-time surface. The UI associates records by ID rather than array order.
The response contains no new private origin coordinates. Proposal persistence continues
to store venue records only; no database migration is needed.

With an older backend, individual durations/coloured areas are unavailable and the UI
keeps the known aggregate result. Deploying both updated frontend and backend enables
the member-level presentation.

## Local verification

Use Node 20+; the default Node 16 on this machine lacks APIs used by the existing checks.

```bash
npm run typecheck
npm run lint
npm run build
node scripts/test-meeting-polish.mjs
node scripts/test-travel-pass-presentation.mjs
node scripts/test-meeting-experience.mjs
node scripts/test-meeting-feedback.mjs
node scripts/test-meeting-voting.mjs
node scripts/test-meeting-privacy.mjs
node scripts/test-outing-pass.mjs
node scripts/test-outing-ui.mjs
node scripts/test-map-ui.mjs
node scripts/test-ui-state.mjs
.venv/bin/python -m unittest discover -s backend/tests -v
git diff --check
```

The isolated `/tests/ui/travel-pass-preview.html` renders the production pass content
with explicitly synthetic inputs, including its mobile sheet and PNG renderer. It
writes no room and requests no real journey. The PNG sample is a design preview,
not a valid personal journey. Fixtures and unit checks do not establish live multi-device
Realtime behavior or a production deployment.

Observed local Chrome checks: 1440px desktop and 390×844 mobile fixtures,
member-colour time bars, category clusters, Bayu selection/name, room QR expansion,
travel-pass drawer expansion/collapse and PNG text/QR readability. No real room was
joined or changed. Individual member regions are coloured in 2D; the native 3D view
continues to show the shared intersection.

The floating avatar visible in browser screenshots is exposed as `flow-ai-assistant`
by a browser extension, rather than a TransitReach component. No Netlify badge
implementation was found in the repository; external browser/hosting controls were
not changed in this source revision.
