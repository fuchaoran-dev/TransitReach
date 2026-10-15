# Epic 8 — Group Outing Invitation and Personal Pass

**MUST HAVE**

As a car-free resident planning with other people in the Klang Valley,
I want a confirmed group meeting to arrive as an invitation and a private personal pass,
So that I know when to leave, whether my journey is still practical, and what the group needs to know without exposing my starting point or route.

Key points: persist one confirmed group place and arrival time, generate a separate arrive-by journey for each member, check that journey against typical delays, connection margins, weather and opening hours, and deliver the result in the shared Epic 8 pass format. The group may see only coarse arrival status. Personal origins, routes, journey legs and check details must remain private. This group-outing scope can be delivered independently of the multi-stop outing planner.

## Scope and Dependencies

- Epic 6 supplies the meeting room, membership, participant identity, member starting point and ranked meeting places.
- Epic 3 point-to-point routing supplies journey legs, map geometry and walking directions.
- Epic 4 supplies typical bus-delay evidence and explicit unsupported results.
- Epic 7 supplies forecast periods and walking-weather context.
- Essential Services supplies reliable opening hours where available.
- This feature supplies shared pass, storage and plan-check foundations that other outing types may reuse later.
- **Add errands is not included in this scope.** It requires the future multi-stop outing planner.

---

## User Story 8.1 — Confirm the Group Plan

As a meeting-room member,
I want the group to confirm one place and arrival time,
So that every personal pass is calculated from the same persisted agreement.

### Acceptance Criteria 8.1.1 — Confirmed Place and Time

Given the room has selected a currently ranked meeting place,
When an authorised member confirms that place and an agreed arrival time,
Then the room stores the confirmed place identity, display name, coordinate, agreed arrival time and a new plan version.

Acceptance checks:

- The confirmed place must be a canonical public venue from the room's current server-ranked proposal.
- A place selected only in local browser state must not be treated as a confirmed group plan.
- The confirmed place identity, display name and coordinate must be persisted together.
- The agreed time must represent the time members should arrive, not a guaranteed service departure.
- Confirmation must create or increment a persisted plan version.
- The plan version must identify the exact confirmed place-and-time agreement used by personal passes.
- Invalid, stale or unranked venue data must not be accepted as a confirmed place.
- Confirmation failure must be communicated explicitly and must not leave the room appearing confirmed.

### Acceptance Criteria 8.1.2 — Shared Confirmation

Given a meeting has been confirmed,
When any current room member views the room,
Then the same confirmed place, agreed arrival time and plan version are shown to that member.

Acceptance checks:

- The confirmation must come from persisted room state rather than one member's local UI state.
- All authorised room members must receive the same confirmed place identity and agreed arrival time.
- Realtime updates may be used, but reopening or refreshing the room must produce the same persisted agreement.
- A nonmember must not gain access to private room data through the confirmation read path.
- The interface must clearly distinguish a confirmed agreement from a place that is only being considered.

### Acceptance Criteria 8.1.3 — Changed Agreement Invalidates Earlier Passes

Given personal passes already exist for the room,
When the confirmed place or agreed arrival time changes,
Then the room receives a new plan version and every pass based on an earlier version is marked outdated until recalculated.

Acceptance checks:

- A place change must create a new plan version.
- An agreed arrival-time change must create a new plan version.
- Unrelated room changes must not create a new plan version.
- A pass must retain the version from which it was calculated.
- A pass whose version differs from the room's current version must not be presented as current.
- An outdated pass may remain visible for reference, but it must be labelled **“Outdated”**.
- A current pass must be produced only after the member's journey is recalculated for the new agreement.
- Shared coarse arrival statuses based on the old version must also be invalidated.

### Acceptance Criteria 8.1.4 — Unconfirmed Rooms Stay in Planning

Given a room has no confirmed place or agreed arrival time,
When a member opens the room link,
Then the room remains in planning mode and does not claim that an invitation or personal pass is ready.

Acceptance checks:

- A ranked or locally selected place alone must not create an invitation.
- A place without an agreed arrival time must not create an invitation.
- A time without a confirmed place must not create an invitation.
- The page must explain that the group is still choosing a place or time.
- The user must not see an enabled **“Open my pass”** action until the shared agreement is complete.
- The incomplete state must not be presented as a routing failure.

---

## User Story 8.2 — Check Each Member's Journey

As a group member,
I want my journey checked against the agreed arrival time,
So that I know when to leave and where my own journey may fail.

### Acceptance Criteria 8.2.1 — Personal Arrive-by Journey

Given I have set my starting point and the meeting is confirmed,
When my personal check runs,
Then the system calculates a point-to-point journey from my starting point to the confirmed meeting place that arrives by the agreed time.

Acceptance checks:

- The routing request must use the current member's starting point only.
- The destination and arrival time must come from the room's persisted confirmed agreement.
- The calculation must use arrive-by behaviour or an equivalent verified calculation.
- A journey for one member must not be reused as another member's journey.
- If the member has not supplied a starting point, the interface must request one before calculating a pass.
- Missing origin data must not be replaced with an invented location.
- Routing failure or no usable arrive-by result must be shown explicitly.
- Modelled journey times must not be described as guaranteed arrival times.

### Acceptance Criteria 8.2.2 — Spare Time at Each Connection

Given my journey contains more than one leg,
When the check runs,
Then every connection shows the estimated spare time between reaching the interchange and the next modelled departure or boarding opportunity.

Acceptance checks:

- Each connection in a multi-leg journey must be evaluated separately.
- Spare time must be displayed separately from in-vehicle, walking, waiting and interchange time.
- The displayed margin must use the same estimated timeline shown by the pass.
- A direct journey with no connection must not display a fabricated connection margin.
- A negative margin must be treated as a failed or infeasible connection rather than spare time.
- If a connection margin cannot be calculated, the interface must show an explicit unsupported state.

### Acceptance Criteria 8.2.3 — Typical Bus Delay Is Carried Forward

Given a bus leg has applicable delay history for its route, stop and hour,
When the check runs,
Then the typical delay is applied to that leg and carried into every later connection and the member's estimated arrival.

Acceptance checks:

- Delay evidence must correspond to the route, relevant stop and time period used by the journey.
- Delay must be displayed separately from scheduled or modelled in-vehicle time.
- A bus leg's typical delay must be applied once and must not be double-counted later.
- Every later connection margin and the estimated arrival must reflect the propagated delay.
- Multiple delayed bus legs must each be evaluated and propagated in travel order.
- The same delay evidence and journey inputs must produce the same checked timeline.
- Historical delay evidence must not be presented as live vehicle information.

### Acceptance Criteria 8.2.4 — Arrival and Closing Margins

Given my journey has been checked,
When the result is displayed,
Then the pass shows the estimated margin before the agreed meeting time and, where reliable opening hours exist, the margin before the meeting place closes.

Acceptance checks:

- Estimated arrival must be compared with the persisted agreed arrival time.
- The arrival margin must use the delay-adjusted estimate.
- A late arrival must be presented as a risk or failed arrive-by result, not as a positive margin.
- Reliable closing time must be compared with estimated arrival.
- Arrival margin and closing margin must remain separate constraints.
- If reliable opening hours are unavailable, the pass must display **“Hours unknown”**.
- Missing hours must not be interpreted as evidence that the venue will be open.
- Opening-hour sources should be identified where available.

### Acceptance Criteria 8.2.5 — Weather Exposure

Given a forecast is available for the journey period,
When the pass opens,
Then it shows the relevant forecast period, its source and the member's total walking time within that period.

Acceptance checks:

- Only forecast periods overlapping the checked journey should be shown.
- Walking exposure must be calculated from the member's own walking legs.
- Walking time must not include rail, bus, waiting or interchange time.
- The forecast source must be visible.
- Forecast information must not be presented as guaranteed conditions.
- If the journey spans several periods, walking exposure should be associated with the applicable periods.
- Missing forecast data must produce an explicit unavailable state rather than invented weather.

### Acceptance Criteria 8.2.6 — Weak Point Is Named

Given the personal check has run,
When the result is shown,
Then the tightest connection, arrival margin or closing-time margin is named in one sentence with the figures behind it.

Acceptance checks:

- All supported connection margins must be compared.
- The margin before the agreed meeting time must be considered.
- The closing-time margin must be considered when reliable hours exist.
- The sentence must identify the affected location or constraint.
- It must include the relevant margin and applied delay where applicable.
- The explanation must correspond to the same values used by the checked timeline.
- No single overall reliability or recommendation score may be shown.
- Equal inputs must select the weak point deterministically using a documented tie-breaking rule.

### Acceptance Criteria 8.2.7 — No Data Is Not “Fine”

Given a leg has no applicable delay history,
When the check result is displayed,
Then that leg is marked **“Not checked”** and looks different from a checked leg that passed.

Acceptance checks:

- Missing delay history must not produce a zero-delay success state.
- The unsupported leg must be identifiable in the ordered journey.
- **“Not checked”** must be communicated with text or an icon, not colour alone.
- The interface should explain which evidence is unavailable in plain language.
- Other legs with valid evidence may still be checked normally.
- A partially checked journey must not be described as fully checked.

---

## User Story 8.3 — Invitation and Personal Pass

As a group member,
I want the confirmed invitation to open into my own pass,
So that the shared agreement becomes a private journey I can follow.

### Acceptance Criteria 8.3.1 — Group Invitation

Given the room has a confirmed place and agreed arrival time,
When a member opens the room link,
Then the system shows an invitation naming that place and time and provides an action to open a personal pass.

Acceptance checks:

- The invitation must use the persisted confirmed agreement.
- The confirmed place, date and agreed arrival time must be visible.
- The opened pass must be bound to the current plan version.
- The invitation must not imply that a personal route exists before the member's origin is checked.
- The invitation must not display another member's origin or route.
- A stale or unconfirmed room must not display a ready invitation.

### Acceptance Criteria 8.3.2 — Personal Pass for Each Member

Given a member opens the invitation,
When their pass is produced,
Then it uses only that member's starting point and shows when they should leave to arrive by the agreed time.

Acceptance checks:

- Each member's pass must be calculated independently.
- The pass must use the current member identity restored on that device or session.
- It must not use another participant's origin as a fallback.
- The leave time must be derived from the checked arrive-by journey.
- Members with different origins may receive different leave times and journey legs.
- Personal pass data must be accessible only to the member to whom it belongs.
- If identity cannot be restored, the invitation or join flow must open instead of another person's pass.

### Acceptance Criteria 8.3.3 — Personal Pass Contents

Given the personal pass is open,
When the member inspects it,
Then it shows the estimated leave time, agreed meeting place and time, ordered journey legs, estimated arrival, arrival margin, walking information, applicable weather and the named weak point.

Acceptance checks:

- Estimated leave time must be prominent.
- The meeting place and time must match the current room plan version.
- Every journey leg must appear in travel order.
- Walking, transit and interchange components must be distinguishable.
- Connection margins must appear beside the connections they describe.
- Typical delays and unsupported states must be visible on the affected legs.
- Estimated arrival and arrival margin must use the checked timeline.
- Walking information must relate only to the current member's route.
- Weather and opening-hour context must remain visible.
- The named weak point must be visible without an overall-score view.

### Acceptance Criteria 8.3.4 — Times Are Estimates

Given any journey time is displayed in the invitation or pass,
When the member reads it,
Then the interface uses estimated wording and never presents the value as a guaranteed scheduled departure or arrival.

Acceptance checks:

- Leave time should use wording such as **“Leave around 5:40 pm”**.
- Estimated arrival must be labelled as estimated or use equivalent plain language.
- The agreed meeting time must be distinguishable from estimated arrival.
- Historical delay estimates must not be described as live predictions.
- Frequency-based times must not be presented as exact vehicle departures.
- Downloaded pass content must preserve the same wording.

### Acceptance Criteria 8.3.5 — Canonical Epic 8 Pass Format

Given a group meeting produces a personal pass,
When the pass is displayed,
Then it uses the shared Epic 8 pass structure rather than a separate group-only pass design.

Acceptance checks:

- The pass must use shared sections for leave time, ordered legs, arrival, context, weak point and actions.
- Group invitation content may wrap the pass but must not replace its canonical structure.
- Shared status labels must have the same meanings across Epic 8 plan types.
- The renderer must not depend on the Epic 2 optimiser.
- Other Epic 8 plan types should be able to reuse the same foundational model and components.

### Acceptance Criteria 8.3.6 — Privacy in the Group View

Given several members hold personal passes,
When the group arrival-status view is shown,
Then it displays only each member's display name and coarse arrival status.

Acceptance checks:

- Allowed statuses include **“Ready”**, **“Check needed”** and **“Not checked”**.
- Another member's starting-point label or coordinate must not be returned.
- Another member's journey legs, route geometry or walking directions must not be returned.
- Another member's detailed delay, weather, margin or weak-point result must not be returned.
- The restriction must be enforced by the server-side data-access boundary, not only hidden in the interface.
- A nonmember must not be able to enumerate member statuses or private passes.
- The current member may inspect their own pass without widening access for others.

---

## User Story 8.4 — Keep It and Find It Again

As a group member,
I want to save my personal pass and return to it on the day,
So that I do not have to reconstruct my meeting journey.

### Acceptance Criteria 8.4.1 — Download

Given my personal pass is open,
When I select **“Download”**,
Then an image is saved containing my estimated leave time, journey legs, meeting place and weak point and remains readable offline.

Acceptance checks:

- Estimated leave time, ordered legs, meeting place and agreed time must be visible.
- Estimated arrival or arrival margin should remain visible.
- The named weak point and estimated wording must be preserved.
- The image must not include another member's name, origin, route or check details.
- Download failure must be reported instead of presented as success.

### Acceptance Criteria 8.4.2 — Group QR Code

Given a group pass is open or downloaded,
When its QR code is scanned,
Then it opens the room invitation flow using an opaque room reference.

Acceptance checks:

- The QR must identify the room through an opaque reference or URL.
- A device that restores the same member identity may continue to that member's live pass.
- A device that cannot restore identity must open the invitation or join flow.
- A new person must supply their own starting point before a pass is calculated.
- Scanning must not open another member's personal pass.
- Invalid or expired references must produce an explicit unavailable state.

### Acceptance Criteria 8.4.3 — My Passes

Given a member has produced one or more personal passes,
When they open **“My passes”** on the same device,
Then each upcoming group pass available to that member is listed and can be reopened.

Acceptance checks:

- Only passes available to the current device or restored identity may be listed.
- Each item should identify the outing, confirmed place and agreed time.
- Current state, such as **“Still holds”** or **“Outdated”**, must be visible.
- Selecting an item must reopen its live pass or invitation flow.
- Past or invalid passes must not appear as current upcoming passes.
- An empty list must show an explicit no-passes state.

### Acceptance Criteria 8.4.4 — Re-check on Reopening

Given a pass is reopened before the meeting,
When newer forecast or delay information is available,
Then the personal check runs again and states whether the plan still holds.

Acceptance checks:

- Reopening must compare the stored pass version with the current room version.
- A pass for an old version must be marked outdated before being treated as current.
- New delay evidence must update later connection and arrival estimates.
- New forecast information must update weather exposure.
- The last successful result may remain visible during refresh with its check time.
- A retained result must not be presented as current after the plan changes.
- Refresh failure must preserve an honest last-checked state rather than fabricate success.
- A completed refresh must state **“Still holds”**, **“Check needed”** or an equivalent result.

### Acceptance Criteria 8.4.5 — Nothing Private in the Code

Given a group QR code is generated,
When its encoded value is inspected or shared,
Then it contains no member identifier, starting point, route, journey geometry or personal check result.

Acceptance checks:

- The payload may contain only the opaque room reference and invitation-flow information.
- Member IDs must not appear in query parameters or fragments.
- Starting-point labels and coordinates must not appear.
- Journey legs, route geometry, delay, weather, margin and weak-point results must not appear.
- Personal data may be resolved only after the scanner is authorised or supplies their own information.
- Automated tests should inspect generated QR payloads for prohibited fields.

---

## User Story 8.5 — Fix It and Carry On

As a group member,
I want to act on my personal weak point from the pass,
So that I can improve my journey without exposing it or silently changing the group agreement.

### Acceptance Criteria 8.5.1 — Suggested Personal Fix

Given a personal weak point has been named,
When a supported fix exists,
Then the pass offers **“Leave earlier”** or **“Choose another journey”** without changing the confirmed group place or time.

Acceptance checks:

- A suggested fix must relate to the named weak point.
- **“Leave earlier”** may change the member's departure constraint but not the group arrival time.
- **“Choose another journey”** may replace the private route but not the meeting place.
- Applying a fix must request a new routing result rather than edit displayed times in place.
- Unsupported fixes must not be shown as enabled actions.
- Fix actions and results remain private to the current member.
- The group pass must not show an enabled or placeholder **“Add errands”** action in this scope.

### Acceptance Criteria 8.5.2 — Suggest Another Meeting Time

Given my checked journey cannot reliably reach the meeting,
When I select **“Suggest another time”**,
Then I return to the room with a proposed time while the current confirmed agreement remains unchanged.

Acceptance checks:

- The proposal must be clearly distinguished from the confirmed time.
- Submitting it must not immediately change the room agreement.
- Existing passes remain tied to the current version until a new agreement is confirmed.
- Other members must not receive the proposer's private route or weak-point details.
- Confirming a new time must create a new plan version and invalidate earlier passes.

### Acceptance Criteria 8.5.3 — Re-check After a Change

Given my journey choice changes or the room confirms a new place or time,
When a replacement journey is calculated,
Then the complete personal check runs again and my pass updates to the applicable plan version.

Acceptance checks:

- A changed journey must rerun connection, delay, arrival, closing-time and weather checks.
- A changed group place or agreed time must trigger a new arrive-by calculation.
- The replacement pass must identify the room plan version it uses.
- The old pass may remain visible during recalculation only with its previous check time and outdated state where applicable.
- Failed recalculation must not replace the last valid pass with incomplete data.
- Successful recalculation must update leave time, legs, margins, weather and weak point.
- The shared coarse status must update without exposing the detailed result.

---

## Out of Scope

- Completing or substituting for the Epic 2 multi-stop optimiser.
- Adding errands, reordering errands or calculating private multi-stop additions.
- Showing another member's route, journey legs or starting point in the invitation, group view, QR code or downloaded image.
- Treating weather forecasts, historical delays or modelled journey times as guaranteed operating information.
- Using a locally selected venue as a confirmed room-level agreement.
