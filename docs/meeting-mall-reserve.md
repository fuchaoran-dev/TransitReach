# Local follow-up: mall reserve and pass duration consistency

16 October 2026. Not pushed or deployed. The production release remains `bae4f6e`.
This addresses the limitations recorded in the release re-verification report.

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

## Verification — 16 October 2026

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
  This verifies new local routing logic, not a deployed multi-account acceptance
  test or a latency guarantee. Production still uses the earlier release.
- PNG regression checks inspect actual canvas text against the page formatter;
  a fresh native browser download was not performed for this follow-up.
