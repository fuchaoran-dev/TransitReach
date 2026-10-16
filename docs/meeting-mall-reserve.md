# Mall reserve and pass duration consistency

Released on 16 October 2026 (MYT), runtime `945b63372736c22094dad590373dc4538f1eb2d1`.
This addresses the limitations recorded for the earlier `bae4f6e` release.

## Release and live verification

- Merged upstream main `64c1900` without conflicts, including the saved personal
  journey opening fix from `50ac178`. Pushed the runtime merge to upstream main
  and the origin Render deployment branch `deploy/md8-6-20261008`.
- Render deploy `dep-db8rauei0phs738oco80` showed **Deploy succeeded / Live** with
  source `945b633`. Netlify production deploy `6ad1b641c9c677c38c4c469a` was ready
  and published at 13:29:44 MYT. No SQL migration or environment changes.
- The production homepage and bootstrap returned 200. Entry JS/CSS and meeting,
  My Passes and Supabase client chunks matched the local build byte for byte.
  The live PostgreSQL bootstrap contained 186 mall records; that is the source
  inventory, not a count of malls reachable by any particular group.

An isolated post-release run used the actual frontend short-poll client through
the production Netlify proxy, real Supabase Auth/PostgreSQL, and live OTP. Five
public station origins were Sunway Lagoon, Sunway-Setia Jaya, USJ 7, Subang Jaya
and IOI Puchong Jaya; the last member later changed to Subang Jaya. Meeting:
17 October 2026, 18:30 MYT; travel budget: 60 minutes.

| Scenario | Complete area preview | Verified places ready | Slowest HTTP poll | Verified malls |
| --- | ---: | ---: | ---: | ---: |
| 3 members | 9.70 s | 19.21 s | 2.94 s | 1 |
| 5 members | 11.41 s | 28.57 s | 3.38 s | 1 |
| 5 members, changed origin | 10.67 s | 29.74 s | 4.57 s | 2 |

All callers received the same current-revision results, complete member areas
and a nonempty actual polygon intersection. Returned malls were inside that
intersection. No HTTP polling failures occurred. Total computation can exceed
26 seconds while each short HTTP poll remains below the proxy deadline; these
measurements are not a worst-case latency/cold-start guarantee.

Forty integration checks plus scoped cleanup passed: automatic Ready planning,
new-member invalidation, peer proposal Realtime delivery, participant RLS, five
votes before confirmation, late-join rejection, five real arrive-by Pass routes,
and changed-origin cancellation of old votes/agreement with stale revision 409.
Pass journeys had real geometry and took approximately 36.35, 42.18, 12.48, 22.62
and 46.67 minutes, all within budget. Browser-storage validation used isolated
in-memory localStorage; this was not five independent browser downloads.

Only this run's temporary room and six newly created anonymous identities were
removed and cleanup verified. Existing rooms/users were not modified. Native
Chrome separately verified the labelled synthetic historical/upcoming saved-Pass
fixture: title/back controls, saved-journey explanation, street-backed route and
return behaviour. Fixture routes are not live meeting evidence.
The refreshed production page also rendered the street map, current seven-day
weather and navigation in native Chrome without the database-unavailable screen.

The merged release passed 97 backend tests and 731 assertions across 15 frontend
scripts, plus typecheck/build/diff checks. Lint had zero errors and 18 existing
warnings. No mobile acceptance or fresh native PNG download is claimed here.

## Mall reserve

The initial category-balanced shortlist still contains at most 12 venues. If it
produces no verified mall, check up to six additional, previously untested malls
from the same all-member-surface-screened ranking. Check two at a time and stop
after the first successful batch; do not keep searching to fill a fixed mall quota.
Every returned mall still needs an arrive-by route for every group member within
the budget. Non-mall ranking, shared job coordination and final revision/budget
storage guards are unchanged.

Maximum: 18 venue checks, rather than unlimited category search. The initial
shortlist and reserve share the existing verification deadline (45 seconds for
short-poll jobs; legacy synchronous defaults remain 25 seconds) and process-wide
six-request OTP semaphore. The job's 90-second deadline is unchanged. Reserve
outages/timeouts cancel pending work and never publish unverified/partial places.
The already-computed complete area preview may remain visible as before.

This increases work only when the first shortlist has no verified mall; it does
not guarantee a mall exists or that every feasible mall will be found. Exhausted
bounded search still uses the honest empty-shortlist message. Longer calculations
remain possible and must be measured, not called a free performance improvement.

## Pass duration

PNG journey totals now call the same `minutesLabel` function used by the page,
using the same arrival-minus-departure seconds. Both round upward and use the
same hour/minute formatting. Exact route timestamps and travel-time calculations
are not modified. Existing downloaded PNG files do not update automatically.

## Regression scope

- Five-member case: first three malls fail one member's route, a later mall
  succeeds, and search stops without testing every remaining mall.
- No reserve requests when an initial mall is valid.
- Unreachable reserve respects the six-extra-candidate cap.
- Reserve outage and deadline cancel pending work without storing partial places.
- PNG canvas text matches page formatting for zero, exact-minute, fractional-minute,
  6-minute-20-second, exact-hour and over-hour durations.

Tests use controlled fixtures unless separate live-routing evidence is recorded.
No cloud schema/room/identity changes are needed by this implementation.

## Pre-release local verification — 16 October 2026

- 97 backend tests passed; related frontend checks passed (meeting experience 77,
  Expo fixes 53, meeting voting 60, Pass presentation 36 assertions).
- Typecheck/build/diff checks passed. Lint: zero errors, 18 existing warnings.
- A read-only integration calculation used the production PostgreSQL bootstrap
  and live OTP, with five public station starts: Sunway Lagoon, Sunway-Setia Jaya,
  USJ 7, Subang Jaya and another Subang Jaya start. Arrival: 17 October 2026,
  18:30 MYT, 60-minute budget (the earlier changed-origin scenario).
- Local new service code published all five areas after about 6.83 seconds and
  completed after about 19.97 seconds. The initial 12 candidates had no verified
  mall; two replacement candidates yielded SS15 Courtyard and Sunway Geo Avenue,
  each checked for all five starts. Total result: two stations, one restaurant,
  two malls. Search stopped after that successful batch.
- Only room load, revision authorization and proposal storage were controlled
  fixtures; source POIs and routing were real. No cloud room/auth/schema write.
  This local check alone did not verify a deployed multi-account flow or provide
  a latency guarantee; the separate post-release run above covers that flow.
- PNG regression checks inspect actual canvas text against the page formatter;
  a fresh native browser download was not performed for this follow-up.
