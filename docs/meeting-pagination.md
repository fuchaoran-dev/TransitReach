# Verified places, then Find more

Released on 16 October 2026 (MYT), runtime `9a39d9e568e8465b170e0ff5cf06ee439333c1f8`.
Pushed to upstream main and the origin Render deployment branch. No SQL migration
or environment changes were made. Backend was deployed before the frontend.

## Production release

- Render deploy `dep-db8s87mq1p3s739730j0`: **Deploy succeeded / Live**, source
  `9a39d9e`. Health returned 200; live OpenAPI includes the finite `page` request
  and `searchPage`, `hasMore`, `checkedPlaces` response contract.
- Netlify production deploy `6ad1c51bf1ba0b88103a8404`: ready, published at
  14:33:08 MYT. Public site: https://transitreach-kl-team8.netlify.app/.
- Production entry JS/CSS and meeting, My Passes and Supabase client chunks were
  byte-compared with the local release build and matched. Native Chrome showed
  the normal street map, navigation and current weather without a bootstrap error.
- Upstream main had no new commits to merge at the release preflight. User-owned
  report JSON, Word files and local artifacts were excluded from the commit.

### Post-release live acceptance

The actual frontend short-poll client was bundled into a Node harness with six
isolated real anonymous Supabase sessions (five members and one late visitor).
Calls went through the production Netlify proxy to the deployed Render service,
real PostgreSQL and OTP. These are independent authenticated callers, not five
physical browser windows. The public station origins and 17 October 18:30 MYT
meeting match the read-only comparison below; no real user's device coordinates
or existing room were used.

| Live scenario, 60-minute budget | Verified places | Elapsed | Slowest HTTP poll |
| --- | ---: | ---: | ---: |
| 3 members, first page | 12 | 19.70 s | 2.62 s |
| 5 members, first page | 12 | 34.01 s | 3.89 s |
| 5 members, Find more | 24 cumulative | 23.41 s | 7.07 s |
| 5 members, repeated completed page | 24 cumulative | 3.50 s | 3.40 s |
| 5 members, malls only | 3 | 26.48 s | 3.19 s |
| 5 members, changed origin, first page | 9 | 32.57 s | 3.68 s |

All callers received identical current-revision results and a nonempty actual
intersection of all member areas. No polling HTTP failures occurred. The first
five-member area preview arrived after about 9.72 seconds, before the verified
places. Continuation retained all 12 previous places, added 12 more and returned
the same cumulative list on the cached repeat. Malls-only returned only malls;
all five screened candidates were checked, three passed, and `hasMore` was false.
The changed-origin first page hit the 24-check cap with nine verified places and
`hasMore: true`, so Find more remains available; 12 is a target, not fabricated
minimum coverage. Returned malls were inside the displayed common intersection.

Sixty-nine integration assertions plus scoped cleanup passed. The same run also
verified automatic Ready planning, joining-member invalidation, real Realtime
delivery of a peer proposal, participant RLS, all five votes before confirmation,
late-join rejection and old-revision HTTP 409 after a non-host changed origin.
Five actual frontend-generated arrive-by Pass routes had real geometry, arrived
by the meeting and took about 36.35, 42.18, 12.48, 22.62 and 46.67 minutes. Their
storage validation used isolated in-memory localStorage, not native downloads.
Only this run's temporary room and six newly created anonymous accounts were
removed; cleanup was verified and existing rooms/users were preserved.

Observed production latency differs from the local read-only times below; neither
is a worst-case or cold-start guarantee. Cache expiry/failure controls and peer
unseen-page markers are covered by controlled tests, not a new production fault
injection or five-browser visual test.

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
