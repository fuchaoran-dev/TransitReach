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

The existing OTP reference date used for meeting ranking remains provisional and
is disclosed in the planner. A personal pass uses the actual agreed arrival date
and an `arriveBy=true` query. A routing failure is visible and produces no ready pass.

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
