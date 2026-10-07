# MD8-6 group invitations and personal passes

Meet now confirms a public ranked venue and a Malaysia-time arrival as a versioned
room agreement. A member opens the invitation to calculate their own arrive-by pass.
My Passes lists upcoming passes stored in this browser under the same anonymous
Supabase identity. Reopening recalculates the journey and checks current evidence.

## Required service setup

1. Install frontend dependencies with `npm ci` using Node 20 or later.
2. Apply `supabase/transit-data.sql` before the updated `supabase/meeting-rooms.sql`
   in the intended Supabase project. Review the latter as a migration: it moves
   existing creator metadata to a private table, restricts participant reads to
   the caller, adds confirmation/status RPCs, and invalidates previous checks.
   The code change does not execute these SQL files or modify an existing database.
3. Configure the frontend's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, enable
   anonymous sign-in, and configure the backend's `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `OTP_BASE_URL`. See `.env.example` and `backend/README.md`.
4. Run the FastAPI backend and OTP 2.5.0. For local integration, set
   `DEV_API_TARGET=http://127.0.0.1:8000` when starting Vite. The server performs
   shared meeting calculations; browsers receive only public ranked venues and
   aggregate travel-time comparisons. Confirmation accepts current, unexpired
   server proposals rather than arbitrary browser coordinates.

### Local configuration and verification

Keep `VITE_SUPABASE_URL`, `SUPABASE_URL` and the project identity in `DATABASE_URL`
consistent. Do not reuse a hosting environment's public key if it belongs to a
different project. Put that project's publishable/anon key in both
`VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`; never put a secret/service-role key
in the browser. Enable anonymous sign-in in the same project's Auth settings.

For local integration put `DEV_API_TARGET=http://127.0.0.1:8000` in `.env.local`.
Vite loads this server-side setting without shipping it to the browser. Start:

```bash
.venv/bin/uvicorn backend.app.main:app --env-file .env.local --port 8000
npm run dev -- --host 127.0.0.1 --port 5173
```

Restart both processes after changing configuration. For a deployed build, configure
the two `VITE_SUPABASE_*` values on Netlify and the server variables on Render, then
rebuild/redeploy separately. Updating `.env.local` or applying SQL does not update an
already-deployed service.

An explicitly requested live database check is available below. It creates synthetic
identities and room fixtures inside one transaction and rolls them back, including
on failure. It does not apply the schema or modify real rooms. The optional routing
check uses only public station coordinates, not another member's starting point.

```bash
.venv/bin/python scripts/check-meeting-database.py
.venv/bin/python scripts/check-meeting-database.py --check-routing
```

For an explicitly authorized live release smoke test against Netlify, run:

```bash
.venv/bin/python scripts/check-meeting-online.py --api-base https://transitreach-kl-fuchaorantransitreach.netlify.app --run-live
```

This creates two temporary anonymous Auth identities and one temporary room,
uses public station coordinates, checks live authenticated ranking/arrive-by
journeys and cross-session realtime, and removes only its own records in `finally`.
It requires the local database and public Auth settings to identify the same
project. It does not apply SQL or edit existing rooms/deployment variables. No
tokens or keys are printed. `check-meeting-realtime.mjs` is its internal companion.

See [MD8-6 acceptance record](md8-6-acceptance.md) for what was actually verified and
the remaining authentication/multi-device release checks.

The existing OTP reference date used for meeting ranking remains provisional and
is disclosed in the planner. A personal pass uses the actual agreed arrival date
and an `arriveBy=true` query. A routing failure is visible and produces no ready pass.

### “Shared rooms are not set up on this deployment”

This message means the frontend was started or built without
`VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`. It is displayed before any
database request, so it does not establish whether the room migration has run.
`DATABASE_URL` alone does not configure browser authentication or room sharing.

For local development, set the two frontend variables in `.env.local` using the
intended Supabase project's URL and publishable/anon key, then restart Vite.
For a hosted frontend, set them in the hosting provider's build environment and
rebuild/redeploy; changing server-only runtime variables cannot update an
already-built Vite bundle. Never use a service-role or secret key in `VITE_*`.

After this configuration is loaded, anonymous sign-in and the room SQL schema
must also be enabled in the same Supabase project. These are separate setup
steps; missing tables/functions or disabled sign-in produce request errors
rather than this unconfigured message. Backend tests and services must load
their server environment explicitly; Vite's `.env.local` loading does not
automatically configure a Python process.

## Privacy and evidence

- Shared room reads return names and Ready / Check needed / Not checked. The
  private origin projection is returned only to its owner. Group calculations
  require a Supabase-validated bearer token and a live room membership.
- The opaque room QR opens the invitation. It carries no member ID, origin,
  route or check result. A new device must explicitly join and set its own origin.
- Personal route geometry, directions and checks are stored locally. The PNG
  download includes only that member's journey and a room invitation QR; it is
  a planning aid, not an operator-issued ticket or fare credential.
- A new confirmed place/time increases the plan version. Origin changes clear
  the member's coarse status. Proposing another time never changes the agreement
  without explicit confirmation.
- Historical bus delays apply once and reduce connection margins against fixed
  onward departures. Missing delay evidence stays Not checked. Opening hours
  use the source rule with explicit unknown/conditional states; `24/7` has no
  closing-time constraint.
- Official forecasts are regional morning/afternoon/night forecasts, not route
  microforecasts. The current verified district mapping covers clearly identified
  Kuala Lumpur venues; other places show Weather unknown. Walking exposure is
  split at exact Malaysia-time period boundaries. Weather does not alter delays.
- A failed re-check cannot claim that the saved plan still holds. Downloaded
  images remain readable offline but cannot update themselves.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run test:outing-pass
node scripts/test-meeting-privacy.mjs
node scripts/test-outing-ui.mjs
node scripts/test-ui-state.mjs
node scripts/test-map-ui.mjs
.venv/bin/python -m unittest backend.tests.test_meeting_api -v
git diff --check
```

`/tests/ui/outing-preview.html` is an explicitly labelled synthetic preview of the
production invitation, personal pass and coarse member-status components. It
does not join rooms, write to databases or enter the production build. Full
multi-device acceptance requires applying the migration and configuring the
services above; fixture checks do not establish live database RLS or realtime
propagation.
