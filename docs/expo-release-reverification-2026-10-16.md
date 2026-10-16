# Production re-verification — 16 October 2026 (MYT)

Runtime: `bae4f6ef5d06b01ff720d571d9dfa729c8a21dcd`.
Public site: https://transitreach-kl-team8.netlify.app/.
This was verification, not a new runtime release or SQL migration.

## Live scope and results

An isolated live run used six temporary anonymous Supabase identities: five group
members and one late visitor. Public GTFS stations from the production PostgreSQL
bootstrap supplied the origins: Sunway Lagoon, Sunway-Setia Jaya, USJ 7, Subang Jaya
and IOI Puchong Jaya. Meeting arrival: 17 October 2026, 18:30 MYT; budget: 60 minutes.
No real member's device location or existing room was used.

The actual frontend `fetchCommonGround` implementation was bundled into a Node
harness and called concurrently for independent real Auth sessions, through the
production Netlify API proxy to Render/PostgreSQL/OTP. The session getter supplied
each test session in memory. This is real multi-account integration, not five
independent browser windows or a general contention benchmark.

| Scenario (completed run) | All-member area preview | Verified places ready | Slowest HTTP poll | Results |
| --- | ---: | ---: | ---: | --- |
| 3 members / 60 min | 8.12 s | 17.58 s | 2.49 s | 10 places, including 1 mall |
| 5 members / 60 min | 9.43 s | 28.46 s | 3.91 s | 5 places, including 1 mall |
| 5 members / changed origin / 60 min | 9.62 s | 27.53 s | 2.97 s | 3 places; no mall in this shortlist |

All three calculations returned five/three complete member areas as appropriate,
10 actual intersection pieces, the current revision and identical results for all
callers. No polling HTTP failure or 504 occurred. Returned malls were inside the
displayed intersection and carried verified per-member trips within the budget.
The total calculation may exceed 26 seconds; individual short HTTP polls do not.
These observations are not a worst-case latency or cold-start guarantee.

Other live checks passed:

- Unshared member stays Not ready; no partial-group automatic start.
- All shared origins automatically prepare a round; no creator Start call.
- Joining a new unready member invalidates old proposals until everyone is ready.
- A real Supabase Realtime room event followed a peer mall proposal; all five
  member-safe state reads contained that same proposed mall.
- Participant table RLS returned only the caller's private record.
- First through fourth votes did not confirm; the fifth vote confirmed the same
  mall for every member. This tested unanimous voting, not tied/plurality voting.
- Late visitor could read the public agreement; joining was correctly rejected
  with `meeting_planning_started` until reopening. UI copy is separately covered
  by the controlled regression, not a new browser login in this run.
- Actual frontend `generateTravelPass` created five real arrive-by personal passes
  for that confirmed mall. Selected journeys were approximately 36.35, 42.18, 12.48,
  22.62 and 46.67 minutes; all had real geometry and arrived within the agreement
  and 60-minute budget. Storage validation used isolated in-memory localStorage,
  not a claim that all five passes were saved/downloaded in real browsers.
- Changing a non-host origin invalidated confirmation/votes and automatically
  prepared a newer round. Old revision requests returned 409, not stale proposals.
- 40 integration assertions plus scoped cleanup passed in the completed run.
  Only the run's temporary room and six newly created anonymous identities were
  removed. Existing rooms, users, agreements and environment settings were retained.

An earlier run had also completed the 3-member (21.03 s) and 5-member (29.05 s)
scenarios without HTTP failures, but stopped at an overstrict test assumption that
a changed origin must always yield a mall. Its temporary data was also cleaned.
The completed run retained and documented the empty mall result rather than
inserting a fake result or treating it as a failed network calculation.

## Desktop and download checks

- Production homepage returned 200; entry `index-bccpUotk.js` matched the release
  build. Production OpenAPI includes the job endpoint.
- Native Chrome initially became inaccessible/grey while the computer was not
  available for automation. After the user restored foreground/unlocked access,
  the refreshed application showed its normal controls and current-date weather,
  without the database-unavailable screen.
- Labelled local meeting-polish fixture: selecting only Malls showed The Summit
  card, its map marker and member time bars. These venue/room/area values are
  explicitly synthetic; they do not substitute for the live calculations above.
- Labelled local meeting-feedback fixture: the actual Pass modal generated the
  KL Sentral → Pasar Seni journey through real OTP. Title and Back button were
  visible above the map/page; the private route map showed real streets and route.
  Back closed the modal and returned focus to Generate my travel pass.
- Download pass produced `transitreach-demn2345-pass.png` in Downloads (about
  2.6 MB). The downloaded image was opened and inspected: street-backed route,
  leg timeline, arrival/departure, walking notes and QR were visible. Its room is
  synthetic, and its QR is not a real group invitation. A synthetic-identity pass
  remains in the local fixture's browser storage; real saved passes were not edited.
- Selecting only Malls in the no-mall fixture showed the new explicit shortlist
  message instead of an unexplained blank panel.

## Findings still open

1. **Bounded shortlist coverage:** category allocation prevents other categories
   from taking every mall slot, but does not exhaustively search all malls. The
   changed-origin scenario returned a valid shared area and other places with no
   mall. Do not equate that with there being no reachable malls. The UI says no
   verified places in this shortlist; deeper/adaptive category search remains a
   possible follow-up, not implemented by this verification task.
2. **Duration rounding mismatch:** the downloaded fixture pass said `6 min journey`
   while the page said 7 minutes. `passImageRenderer.ts` rounds total minutes;
   `components/legPresentation.ts` uses a ceiling. Route times were unchanged, but
   the display convention should be unified in a follow-up fix.

No runtime code was changed or redeployed for these findings.

## Local automated checks repeated

- 92 backend unittest tests passed.
- Expo fixes: 53 assertions; meeting voting: 60; outing pass domain: 42.
- The failure/timeout logs in backend tests are deliberate mocked error cases,
  not live production failures.

Not claimed: five simultaneous GUI sessions, GPS permission flow, physical QR
scanning, tied-vote live acceptance, repeated Render cold starts, phone layout,
or every possible origin/time combination. User scope was desktop web.
