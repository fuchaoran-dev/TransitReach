# Epic 7 — Visual service comparison and departure recommendations

## Mentor feedback → implementation

| Feedback | Implemented behaviour |
| --- | --- |
| Visualise service differences | Map → Services → Compare. Category counts with separate `+n` gained and `−n` lost buttons. Net zero does not hide service turnover. Expand to see names and reasons. |
| Analyse data and recommend departure | Selecting a service automatically checks the selected day's 18:00–21:00 window. Its detail card shows a compact suggestion. Date/time range and priority are under collapsed Adjust; there is no duplicate destination selector. Compare hourly candidates using OTP journeys, the travel budget and OSM hours at estimated arrival. |
| Include rainy-day advice | Avoid-rain priority checks regional forecasts during each timed walking leg, including period and midnight boundaries. Prefer feasible lower-weather-impact alternatives, not a blanket prohibition on essential travel. |
| Explain recommendations and next action | Show date/time, travel/walking time, transfers and weather scope. Other times and Adjust are collapsed. Only Use this time updates the map departure; View journey remains the next action. |

## Comparison acceptance

1. Both snapshots use the same origin coordinates, budget, deduplicated dataset and category/search filters.
2. **In reach** counts geographic coverage only. **Open at arrival** counts a scheduled itinerary within the budget and parsed hours indicating opening at arrival; these are estimates, not venue confirmation.
3. Added and removed services are counted by identity, not just by subtracting totals. Replacing one service with another shows `+1 / −1`.
4. Unknown route/hours evidence at either time appears in `? n`. A transition from known to unknown is not called a confirmed loss, and unknown to known is not called a confirmed gain.
5. Clicking a change badge shows the affected services. Clicking a service uses the existing detail card and Journey flow, retaining origin, departure and budget.
6. Coverage difference colours are orange (baseline only), purple (selected only), teal (both). These represent geography, not weather or opening hours. Both 2D and existing 3D map layers share the same coverage data.
7. A changed origin, budget or filter invalidates comparisons. A changed departure hides a stale pair until comparison is rerun.

## Recommendation acceptance

1. Candidate dates must be inside the next seven Malaysia calendar days and the loaded timetable date range. Missing forecast days are not invented. The rolling seven-day horizon is a near-term outing window aligned with the official general forecast; it is not a claim of seven days of complete coverage.
2. Candidate times are one-hour increments from the user's earliest time through the latest time. Past candidates are excluded. This is best **among checked candidates**, not continuous-time/global optimisation.
3. Feasibility comes before preference: a route must have complete timing, arrive within the travel budget (initial waiting included), and the venue must be estimated open at arrival. Missing/unparseable/conditional hours cannot establish feasibility.
4. Priorities are transparent and deterministic:
   - Avoid rain: weather severity, walking minutes in rainy/storm periods, total walking, elapsed travel, transfers.
   - Less walking: walking, transfers, elapsed travel.
   - Shorter journey: elapsed travel, walking, transfers.
   - Equal results prefer the earlier departure.
5. Weather is a user-selected MET district outlook, not automatic district inference or street-level weather. Select a district in the weather bar's **Details → Forecast area**, then explicitly confirm its relevance under Adjust. Confirmation is scoped to origin, destination and district; changing any of them requires confirmation again.
6. When weather is unconfirmed or unavailable, automatic suggestions use less walking instead of avoid-rain and explicitly state **Weather not included**. Missing or unrecognised periods cannot receive an avoid-rain recommendation; they are not treated as sunny. Other priorities disclose incomplete coverage.
7. Walking across morning/afternoon/night or midnight checks every covered forecast period/date. Never interpret a broad afternoon forecast as “rain stops at 18:30”.
8. A rainy/storm recommendation warns about outdoor exposure. Only claim all eligible alternatives are wet if every such alternative has checked rain/storm evidence. Otherwise suggest trying avoid-rain or another window.
9. Applying an option updates only the shared departure, retaining the selected service, origin and budget. Calculating or displaying a suggestion never changes the shared departure or moves the camera. Recommendations are for a single destination, not Epic 2 multi-stop sequencing or an Epic 8 confirmed group plan.
10. New inputs, navigation away/unmount and Cancel abort ongoing checks. Old results cannot be applied after cancellation. At most two destination/time tasks run concurrently; individual route requests have a 20-second timeout. Rapid selection changes are debounced by 300 ms; successful checks can be reused for five minutes. Arrival-estimate refreshes are not new recommendation inputs.
11. The default window is visibly labelled and uses only the selected day. With no suitable result, View next seven days explicitly broadens to supported dates. It never silently searches a week. Adjust remains collapsed initially; users may choose another window or priority and checks rerun automatically.
12. Before a service is selected, show a prompt and make no recommendation requests. Missing or unparseable hours show an evidence warning, not a fabricated best departure. An invalid or past-only window yields a clear adjustment prompt.

## Verification

```sh
npm run typecheck
npm run test:time-planning
npm run test:outing-pass
npm run build
```

`test:time-planning` uses controlled domain and rendered-React fixtures; it is not proof of upstream availability. Verify live separately:

1. Open the local map, select KL Sentral (or another real origin), open Services, choose a category.
2. Open Compare; retain a morning baseline, select an evening departure, then Compare times.
3. Inspect both comparison bases, expand gained/lost/unknown badges and verify specific names/reasons.
4. Select a service with known hours in Explore or the map. Verify that its detail card automatically checks only the selected day, with no Destination dropdown. Expand Adjust to confirm an appropriate forecast district or change the window. Inspect Other times; no shared date/time changes until Apply.
5. Apply an option, open Journey, and check that departure changed but origin/budget did not. Repeat with unknown hours, a missing forecast, cancellation and changed inputs.

This change does not deploy, push Git branches, alter database credentials or change existing Epic 8 meeting agreements.

### Earlier manual-planner live smoke test — 2026-10-11 MYT

These observations precede the selection-driven UI change; the new UI has separate regression verification.

- Local map loaded through the PostgreSQL API; official forecast endpoint returned real district/day records. No bundled/mock data fallback was used.
- Origin: KL SENTRAL - REDONE; budget: 30 minutes; category: Pharmacies; baseline 2026-10-11 09:00 versus selected 20:00.
- Geographic comparison: 29 → 31 pharmacies, with **+3 gained / −1 lost** (not merely a net +2). Opening-at-arrival comparison separately exposed unknown evidence. The gained available entry could be expanded to BIG with its route/hours reason.
- BIG, same origin and budget, daily window 18:00–21:00, Kuala Lumpur regional outlook explicitly selected: the four checked candidate times produced a recommendation at 19:00 among three eligible options, approximately 25 minutes elapsed travel, 7 minutes walking and 0 transfers; walking-period outlook indicated no rain.
- Applying the recommendation returned to the service detail and updated the shared departure to 19:00. The origin remained KL SENTRAL - REDONE and the budget remained 30 minutes.
- These are smoke-test observations of changing upstream data, not fixed expected counts, guaranteed arrival times or proof of route-level weather. Full production/online deployment remains a separate step.

### Selection-driven UI verification — 2026-10-11 MYT

- TypeScript check, targeted ESLint, production build, 83 time-planning checks and 42 existing Outing Pass checks passed. Fixture tests include automatic single-day selection, no duplicate destination dropdown, collapsed settings, unchanged-estimate/cache reuse, weather consent invalidation, stale request cancellation, stale Apply rejection, explicit seven-day widening and past/invalid windows.
- Live local Chrome: selected KL SENTRAL - REDONE, 30-minute budget, then **BIG pharmacy** (65, Jalan Bukit Bintang). Missing source hours produced a clear warning and no invented recommendation.
- Changed the map departure to 20:00 and selected the distinct service **BIG**. Without another destination form or Check button, the card automatically evaluated the same day's default 18:00–21:00 window, recommending 19:00 among three eligible options (approximately 25 minutes travel, 7 minutes walking, 0 transfers). The shared map departure stayed at 20:00 while the suggestion was displayed.
- Before weather confirmation the card stated Weather not included and used the less-walking fallback. Opened Adjust, confirmed the Kuala Lumpur outlook for this trip, then collapsed it: the resulting suggestion used the avoid-rain criterion and stated no rain forecast during walking periods. Other times and Adjust remained compact disclosures.
- Clicked Use this time. The shared date/time changed to 2026-10-11 19:00; the origin, 30-minute budget and BIG service remained selected. Camera focus was not changed by recommendation calculation.
- Screenshots verified the card's real layout on the existing desktop 3D map. These are changing upstream results, not guaranteed future values. No deployment or Git push was performed.

### Release validation — 2026-10-12 MYT

- Fast-forwarded the latest upstream `main` GroupOutingView fix before release; no existing local work was overwritten.
- Passed 300 frontend domain/render/lifecycle checks across time planning, outing passes, weather/map UI, meetings and performance; 31 backend performance/meeting API regression tests also passed.
- TypeScript check and production build passed. ESLint reported zero errors and 18 warnings; existing chunk-size warnings remain.
- Corrected the origin panel's forecast attribution to use the selected district rather than hard-coded Kuala Lumpur.
- Only the Epic 7 implementation, its tests and this acceptance record are included in the release commit. Local environment files, the unrelated observation report edit and the Word document are excluded.
- This round's native browser connection was unavailable. The previous local browser observations above are retained as dated evidence; new production verification must distinguish HTTP/artifact checks from interactive browser acceptance.
