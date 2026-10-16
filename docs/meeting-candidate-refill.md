# Local follow-up: refill verified common places

Implemented on 16 October 2026 (MYT), subsequently included in released runtime
`9a39d9e` with the paged-search follow-up. The tests below are its pre-release
local/read-only evidence, not a substitute for that release's live acceptance.

The later [paged-search follow-up](meeting-pagination.md) builds on this local
refill implementation; its release, latest tests and continuation results are
recorded separately in that document.

## Why 30 minutes can list five places and 60 minutes only four

The right-hand list contains a checked shortlist, not every reachable POI or a
count of intersection polygons. A budget change moves the forward-preview
departure (`meeting time - budget`) and changes the surface-screened candidate
ranking. New first choices can displace a previously verified place from the
first 12 checks. Previously only a completely missing mall category triggered
replacement checks; ordinary failures left the other categories underfilled.

This revision fixes that candidate-displacement/underfill case. It does not make
the single-departure preview an exhaustive arrive-by time-window calculation.
The limited shortlist is not guaranteed to be a superset at larger budgets.
Neither area nor POIs are fabricated to enforce an increasing displayed count.

## Bounded refill

- Keep the first 12 category-balanced checks and existing no-mall reserve.
- If fewer than 12 proposals pass, continue with untried surface-screened POIs
  from all categories, round-robin within the existing fairness order.
- Check at most four extra candidates per batch, or fewer when fewer results
  are needed. Stop once the target is met, candidates are exhausted, or the
  total reaches 24 checked venues, including any mall reserve work.
- Keep the mall allowance bounded to its initial allocation plus six additional
  malls. Never check the same `(type, id)` twice in one calculation.
- Every new venue still requires a real arrive-by route for every participant,
  within the budget and meeting deadline. Final fairness sorting is unchanged.
- Initial, mall reserve and general refill share the same verification deadline
  (45 seconds for jobs, 25 for the legacy call) and six-request OTP semaphore.
  Job deadline remains 90 seconds. Timeout/outage cancels work, does not save a
  partially checked list, and is not disguised as success.
- No schema, environment variables, source POIs, routing graph or map polygons
  were changed. The desktop header adds a compact `N verified` count that follows
  the local category filters; the existing folded explanation clarifies scope.

## Verification

Five new unit tests cover the displaced thirteenth candidate (five results at
30 minutes remain five at 60 minutes in that controlled scenario), four initial
survivors refilled to 12 across categories, five-member rejection and the total
cap, no extra requests when the first list is full, and cancellation/no store
on a general-refill timeout. Existing mall-reserve tests isolate that phase by
lowering the overall target in their fixture, without changing production limits.

- Full backend suite: 102 tests passed.
- Frontend: 271 assertions across voting (63), experience (77), Expo (53),
  feedback (26), polish (23) and map UI (29) scripts passed.
- Typecheck, build and diff check passed. Lint: zero errors, 18 existing warnings.
- Native Chrome desktop fixture showed `6 verified`, then `5 verified` after
  excluding stations, with readable header/cards. Fixture values are synthetic;
  no action was taken inside the user's real room.

### Read-only real-data comparison

Local service code used the production PostgreSQL public bootstrap and live OTP.
Room loading/authorization/storage were isolated fixtures; no room, Auth, voting
or database write occurred. The baseline disabled only the new general refill,
retaining the existing first shortlist and mall reserve. Both versions used the
same public starts, POI dataset and arrival, 17 October 2026, 18:30 MYT.

Two starts: Monash University Malaysia and Sunway Lagoon. Five starts: Sunway
Lagoon, Sunway-Setia Jaya, USJ 7, Subang Jaya and IOI Puchong Jaya. These are public
locations, not the screenshot members' device coordinates or an exact replay of
their room/time.

| Scenario | Baseline places | Refilled places | Candidate checks, before → after | Total seconds, before → after |
| --- | ---: | ---: | --- | --- |
| 2 people / 30 min | 6 | 12 | 12 → 21 | 3.90 → 5.22 |
| 2 people / 60 min | 6 | 12 | 12 → 22 | 6.52 → 10.01 |
| 5 people / 60 min | 5 | 12 | 12 → 20 | 20.01 → 24.16 |

The refilled five-person list contained five stations, three malls, three cafés
and one restaurant. Its complete member-area preview was available after about
7.28 seconds, before venue verification completed. Malls included The 19 USJ
City Mall, Main Place Mall and KL Eco City Mall. All proposal longest-trip values
were within budget. Counts and timings are observations, not guaranteed minimum
coverage or worst-case latency. They do not prove exhaustive geographic coverage,
venue opening hours, five real browser sessions or a deployed acceptance run.
