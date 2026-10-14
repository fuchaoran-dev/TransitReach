# Meeting room: shared starts and venue voting

The newer released feedback revision is documented in [meeting-feedback.md](meeting-feedback.md):
explicit Share after preview, no duplicated Start pin, meeting-time/individual
departure semantics and a route-only Pass handoff. Runtime `2fb2059` is live.
The workflow below records the historical voting release; use the linked revision
for current sharing and meeting-time interactions.

Updated 14 October 2026. This replaces the meeting page's personal-check/one-person
confirmation workflow, not the separate offline Pass modules. Ready means an
origin was explicitly shared and saved; it is not an arrival, weather or hours check.

## Flow

1. Create or join a room (at most six members), and enter a display name.
2. Allow sharing with current room members, then search, click the map or press
   **Use my current location**. GPS is captured once with fresh geolocation;
   permission denial/timeouts do not invent a location. Clear the point or uncheck
   sharing to withdraw it. Only successful saves produce green **Ready**.
3. Members see shared saved points with permanent display-name labels. These are
   departure points, not a background live-location feed. Full auth IDs and personal
   routes are not in the shared projection. Legacy private points require new consent.
4. After at least two members have joined and everyone is Ready, the creator sets
   shared departure, arrival target and budget, then starts group planning. This
   freezes joining. Everyone uses the same departure and real OTP 2.5 OSM/GTFS inputs.
5. The backend returns each participant's actual isochrone boundaries. The map shows
   lightly coloured individual regions and their filled intersection, including
   holes and disconnected pieces. Circular/radial appearance must never replace
   actual boundaries with a guessed distance circle. **Show everyone** frames origins.
6. Inspect a public ranked venue; **Propose** shares a selection, while **Vote**
   submits one replaceable ballot. Both show other members' names and choices.
7. Only when everyone votes does a unique highest count finalize the venue. A
   2–1–1 outcome is a unique plurality, not unanimity or necessarily a majority.
   A tie retains votes and permits changes. Arrival target is the same for all ballots.
8. Changes to origins, budget or membership invalidate geometry/proposals/votes and
   reopen planning. Host can explicitly reopen. Host departure transfers ownership
   to the earliest remaining member. New confirmations never reuse an old plan version.

Arrival is an agreed target, not proof that all arrivals have been checked.
No personal Pass checking runs on this meeting page. Ranking uses modelled departure
travel-time surfaces, not a live punctuality or opening-hours guarantee.

## Service setup (not yet applied to the cloud in this change)

Apply `supabase/transit-data.sql`, then `supabase/meeting-rooms.sql`, then
`supabase/meeting-voting.sql` in that order. Existing projects need the last migration.
Never run the old meeting script alone after upgrading: its grants and RPCs are older.
Review [SQL contract](meeting-voting-sql.md) before applying. The first upgrade
cancels legacy agreements/checks, retains legacy origins privately, and requires
explicit sharing and a new vote. This is a deliberate migration impact, not data loss
hidden behind a successful UI.

Deploy the matching FastAPI and frontend together after SQL approval. Existing
Supabase and OTP environment variables are unchanged. Old online smoke scripts
`check-meeting-database.py` and `check-meeting-online.py` describe the superseded
direct-confirmation flow; do not use their success criteria for this release.

## Verification

Local automated checks:

```bash
npm run typecheck
npm run lint
npm run build
node scripts/test-meeting-privacy.mjs
node scripts/test-meeting-voting.mjs
.venv/bin/python -m unittest discover -s backend/tests -v
git diff --check
```

SQL regression is `supabase/tests/meeting-voting.sql`, for an explicitly selected
disposable local PostgreSQL instance. Isolated PGlite execution covers actual
migration/RLS/RPC SQL; it does not verify PostgREST schema cache, multi-connection
native locking, Supabase realtime or deployed routing.

Two-browser release acceptance remains required after migration/deployment:

- Missing origin stays Not ready; denied GPS, failed save and out-of-area point do not
  mark Ready. Saving updates both browsers; clearing removes the shared marker.
- Names sit above distinct saved origin markers. No auth IDs/private legs leak.
- Invite holder outside the room cannot fetch members or geometry. A joined member
  sees only explicitly shared origins. Joining a frozen round shows a clear message.
- No routing requests run before explicit start. Area and ranking use the same
  departure/budget. Outage/malformed boundary produces an error, not partial success.
- Proposals appear on the other browser; merely inspecting a venue does not vote.
- One person's vote cannot confirm. Everyone voting for tied options keeps the
  round open; a unique highest count confirms and closes voting.
- Origin/time/budget/member changes invalidate the old round. A stale request or
  ballot cannot confirm it. Host leaving permits the new host to continue.
- Inspect desktop panels at 1280 and 1440px. Current local visual QA used a clearly
  labelled synthetic SSR layout, not a live multiplayer or map-rendering test.

No cloud migration, Git push or deployment was performed in this change.
