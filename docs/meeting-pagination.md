# Local revision: verified places, then Find more

16 October 2026 (MYT). Not committed, pushed or deployed. No SQL migration or
environment change is required. Deploy the backend before this frontend.

## Behaviour and boundaries

- The initial request targets 12 verified places with the existing balanced
  shortlist, mall reserve and bounded general refill. It may return fewer if
  candidates fail; it never inserts unverified places to meet a quota.
- **Find more places** starts a new short-poll batch over untried candidates and
  combines its verified results with the previous pages. Fairness ordering is
  reapplied to the combined list; stable venue IDs, not ranks, identify votes.
- Each page checks at most 24 new candidates and uses the existing six-request
  OTP limit, 45-second job verification budget and 90-second job deadline.
  At most 20 pages are accepted. This is a safety limit, not exhaustive coverage.
- `searchPage`, `hasMore`, `searchLimitReached` and `checkedPlaces` describe the
  selected search. Exhaustion means all candidates in this screened set were
  checked, not every real-world place or every possible departure time.
- The type chips remain immediate local filters. Clicking **Search selected
  types** explicitly opens the corresponding category search (for example only
  malls); it does not launch three new jobs while the user unchecks three chips.
  Each category combination has its own search cursor/cache.
- Pending/failed additions keep previously verified places and map geometry.
  Cache expiry returns HTTP 410 and **Restart search**; the browser does not
  silently treat page zero as a later page. Expired or restarted searches can
  produce a different shortlist. Completed pages remain usable during a failed
  continuation; failed work does not advance the cursor.
- New proposals may originate from a peer's later page/category. Both 2D markers
  and 3D waypoints retain the shared proposed/confirmed public venue even if it
  is absent from the viewer's shortlist, without inventing its rank or member
  travel times. Expanding a search does not reset votes; changing the actual
  room inputs still advances the planning revision and invalidates old results.

## Cache and authorization

The existing single-process meeting job stores immutable search progress: public
candidate ordering, tried IDs, verified member durations and consent-gated area
geometry. It does not retain access tokens, exact participant origins or rasters.
Membership and planning revision are checked on every poll, including cache hits;
the next page reloads current room inputs and checks revision/budget/arrival/types
before using progress, with the existing guarded PostgreSQL write afterwards.

Successful jobs retain progress for five minutes; at most 16 jobs exist. A page
in progress has the existing bounded computation expiry. Failed continuations
keep the previous cursor with a five-second retry cooldown; initial failures
still expire quickly. Simultaneous requests for the same room/revision/budget/
types/page share one calculation. Server restart loses the cursor explicitly.
This is not a durable queue or a cache shared across multiple Render workers.

## Verification

- Full backend suite: **113 tests passed**, including cumulative pages, no repeated
  candidate/area/surface requests, immutable progress after failure, revision/
  budget/time/type guards, finite page bounds, one continuation for five members,
  cached first-page reads during continuation, expired search and authorization.
- Frontend: pagination **42**, voting **69**, meeting experience **83**, Expo **53**,
  feedback **26**, polish **23**, map UI **29** assertions passed (325 total).
  Controlled tests cover retained results, finite errors, HTTP 410, explicit
  category searches, double clicks, cancellation and obsolete responses.
- Typecheck/build/diff checks passed. Lint: zero errors, 18 existing warnings.
- Native Chrome desktop: the labelled synthetic fixture's Find more button
  appended six example cards to its original six, showed `12 verified` and an
  honest exhaustion message, with the original map and cards retained. Synthetic
  fixture places are never imported into runtime data; no real room was touched.

### Read-only real-routing check

Local real `MeetingJobs` and `common_ground` code used production PostgreSQL public
bootstrap records and live OTP. Room loading, membership and proposal storage
were isolated boundaries, so no Auth identity, room, vote or database write was
performed. Five concurrent caller IDs shared one calculation per page; these
were harness callers, not five real signed-in browsers.

Public starts: Sunway Lagoon, Sunway-Setia Jaya, USJ 7, Subang Jaya and IOI Puchong
Jaya. Meeting: 17 October 2026, 18:30 MYT; budget: 60 minutes.

| Page | Cumulative verified places | Cumulative checked candidates | Page elapsed | New member-route queries |
| --- | ---: | ---: | ---: | ---: |
| Initial | 12 | 20 | 27.20 s | 100 |
| Find more | 24 | 36 | 8.64 s | 80 |

The second page made **no** isochrone or surface requests (five of each total),
and no repeated venue checks. A repeated completed-page poll returned the same
result without more routing. Combined categories: nine stations, four restaurants,
three malls and eight cafés. All returned longest-trip values were within budget.
An earlier attempt failed while fetching production bootstrap (HTTP error) and
did not start a room calculation; a later bounded-retry run completed above.
These measurements are not a cold-start/load guarantee or an online deployed
multi-account acceptance result. No mobile or native downloaded-Pass claim.

To repeat controlled regressions:

```bash
.venv/bin/python -m unittest discover -s backend/tests -q
node scripts/test-meeting-pagination.mjs
node scripts/test-meeting-voting.mjs
node scripts/test-meeting-experience.mjs
npm run typecheck
npm run build
npm run lint
git diff --check
```
