# Meeting voting SQL contract

`supabase/meeting-voting.sql` is a separate, transactional migration applied **after**
`supabase/transit-data.sql` and `supabase/meeting-rooms.sql`. The old SQL is unchanged.
Do not reapply the old meeting script afterwards: it would restore older RPCs/grants.
This implementation does not apply a cloud migration, read secrets, or deploy services.

The first application deliberately cancels existing confirmed agreements, proposed
times, server proposal rows and personal checks, and advances each room's revision.
Legacy origins remain stored privately with `origin_shared = false`; they are never
automatically exposed to other members. Owners must explicitly share again. Existing
plan versions are retained in a private counter, so future confirmations cannot reuse
a version held by an old pass. Reapplying this migration preserves active rounds.
The migration's workflow constraint marks completion of this one-time conversion.

## RPCs

All calls require the Supabase `authenticated` role and a valid `auth.uid()`;
anonymous Supabase sign-ins qualify, the unauthenticated `anon` role does not.
Room codes are trimmed and uppercased. A missing, expired, or nonmember room produces
`room_not_found` for member mutations. State reads instead return SQL null.
Timestamp arguments are `timestamptz`; clients send ISO strings with an explicit
offset. Departure and arrival are distinct concepts, never substituted for each other.

| RPC and exact argument names | Return | Contract |
| --- | --- | --- |
| `create_meeting_room(p_nickname)` | text code | Existing signature/behavior; caller is first member and host. |
| `join_meeting_room(p_code,p_nickname)` | void | Existing signature; existing members may rejoin idempotently. New members rejected while started, capacity remains six. |
| `share_meeting_origin(p_code,p_lat,p_lon,p_source,p_label)` | void | Explicitly share the caller's chosen origin. Sources: `stop`, `bus-stop`, `place`, `map`, `device`. All four origin arguments null clears it and withdraws consent. Other partial origins are rejected; label may be null or at most 120 characters. |
| `leave_meeting_room(p_code)` | void | Remove only caller; invalidate/reopen the round. A departing host transfers ownership to the earliest remaining member ordered by `(joined_at,id)`, inside the room lock. |
| `set_meeting_nickname(p_code,p_nickname)` | void | Change caller's name without invalidating votes. Empty/blank becomes null; existing length constraint applies. |
| `set_meeting_budget(p_code,p_budget)` | bigint revision | Host only; options 15/30/45/60. An actual change invalidates and reopens planning. Same value is a no-op. Direct column writes are revoked. |
| `start_meeting_planning(p_code,p_departure_time,p_arrival_time)` | bigint revision | Host only, currently open room, at least two members, everyone has explicitly shared a complete origin. Freeze membership, set shared times, advance revision. `p_arrival_time` defaults to null for a two-argument caller. |
| `reopen_meeting_planning(p_code)` | bigint revision | Host only; always advance revision, unlock membership, clear both times and the round. |
| `set_meeting_arrival_time(p_code,p_arrival_time)` | bigint revision | Host only, started room. A changed time advances revision and clears the round while retaining frozen membership and departure. Identical value is a no-op. |
| `propose_meeting_venue(p_code,p_venue,p_revision)` | JSON state | One replaceable public shortlist selection per member in the current started round; not a ballot. |
| `cast_meeting_vote(p_code,p_venue,p_arrival_time,p_revision)` | JSON state | One replaceable vote per member in the current started round. First valid vote fixes an unset arrival; all later votes must match it. |
| `get_meeting_room_state(p_code)` | JSON or null | Current member-safe snapshot as specified below. |

Starting again requires an explicit reopen first. Departure must be future and no
more than 30 days away; provided arrival must be after departure and within 30 days.
Casts and host arrival changes also require arrival to remain future. Changing a
time through a vote raises `meeting_arrival_time_mismatch`; it never silently resets
other members' votes. Use the host arrival RPC to intentionally begin a new round.

The host is determined from **existing `meeting_room_creators.user_id`**, not a
`creator_id` column on `meeting_rooms`. That mapping remains private. If the last
host leaves an empty room, the mapping becomes null; the first subsequent join
assigns the earliest member as host. Expiry still cleans up empty rooms.

## Selection, voting and invalidation

Selection and vote RPCs require frozen planning, all shared origins, and an exact
`p_revision = planning_revision`. They resolve `p_venue.id/type` against existing
public reference data, then require an unexpired, server-generated row in
`meeting_plan_proposals` for the same room, revision and venue identity. Caller
coordinates, names and other venue metadata are ignored; stored/public venue JSON
is canonical. A browser cannot add or edit server proposals.

Votes do not require a prior shortlist selection. Selections can differ from votes;
changing a selection does not change a ballot. Each table has primary key
`(room_code,user_id)` and a cascading membership foreign key. A room row lock
serializes every public mutation before touching participant/selection/vote rows.
Concurrent first votes cannot choose different shared times.

Confirmation waits for **every member** to vote in the same revision and at the
same arrival. A unique highest count auto-finalizes, including a 2–1–1 result;
this is unique plurality, not unanimous agreement or necessarily a majority.
Tied highest counts yield `tie`, retain votes, and permit replacement votes.
Once confirmed, votes/selections close until the host reopens or changes arrival.
Proposal expiry is checked when a selection/vote is accepted; an accepted vote
does not itself expire with the proposal. Recalculating expired proposals in the
same revision permits later votes. A removed winning public reference raises
`meeting_venue_unavailable` instead of fabricating confirmation or a tie.

Changing an origin (including sharing a previously private point, its source or
label, or clearing it), budget, or membership advances the revision and reopens
planning. Reopen/start/host arrival changes also advance the revision. Every such
advance clears **all** votes, selections, server proposals, confirmed venue/time,
and personal checks; it sets visible `plan_version = 0`. Arrival changes retain
started status; origin/budget/member changes clear started status and both times.
An identical origin/budget/arrival write does not invalidate the round. Nickname
and private check changes only touch the room timestamp. New confirmations use a
monotonically increasing version despite intervening invalidations.

## Safe snapshot

The top-level shape is `{room,self,members,votes,selections}`. Arrays are empty
when absent and ordered by member join order, with participant ID as a tie-breaker.

- `room`: existing `code,time_budget,expires_at,updated_at,planning_revision,
  confirmed_venue,confirmed_arrival_time,plan_version,proposed_arrival_time`, plus
  `planning_started,departure_time,voting_arrival_time,is_host,vote_status`.
  `vote_status` is exactly `waiting | tie | confirmed` and lives **inside room**.
  `proposed_arrival_time` is retained for compatibility and cleared by this workflow.
- `members`: `{id,display_name,is_self,colour_slot,lat,lon,at,label,planning_status}`.
  `at` is `{lat,lon}` or null. Unshared origins expose null coordinates/label.
  `planning_status` is `Ready` only when the member has explicitly shared a complete
  origin, otherwise `Not ready`. It never represents a personal journey/check result.
- `votes`: `{member_id,display_name,venue,arrival_time}` for the current revision
  and shared arrival only.
- `selections`: `{member_id,display_name,venue}` for the current revision only.
- `self`: caller's participant fields, including `origin_shared` and legacy private
  check fields, **without `user_id`**. Derive the caller's auth ID from its session
  if needed. Full own raw rows, including auth ID, remain readable through RLS.

`id`/`member_id` are room participant UUIDs, never auth user IDs. No shared member
source, personal arrival status, checked version, creator identity, route or check
details are projected. The narrower old invitation RPC remains available and
exposes only the confirmed public agreement to an authenticated code holder.

## Security and compatibility

Full participant SELECT remains owner-only under the old RLS policy. Direct
participant UPDATE/DELETE and room UPDATE grants are removed; use origin, nickname,
leave and budget RPCs. Votes and selections have RLS enabled with no browser
table grants/policies. Server proposals and creator mappings retain no browser
access. Internal helpers cannot be executed by browser roles. Security-definer
functions fix `search_path = ''` and qualify application tables.

The room guard also rejects a budget change from a nonhost JWT, including inside
a security-definer call: `current_user` there is the function owner, not the caller.
Owner SQL without an auth subject is an administrative boundary and is not a
browser capability. The confirmation guard requires a complete unique-plurality
ballot even if a future write grant becomes too broad. The old
`confirm_meeting_plan(p_code,p_venue,p_arrival_time)` only acknowledges the exact
already-finalized agreement; it raises `meeting_votes_required` otherwise.
`propose_meeting_time` delegates to the host arrival RPC. Private pass-check RPCs
remain compatible and room-locked, but the meeting workflow does not require them.

Only the non-sensitive room timestamp/row is used for shared realtime invalidation.
The migration removes participants from `supabase_realtime`; votes/selections are
not added. Members refetch the safe snapshot. This also avoids participant DELETE
primary-key events being shared. SQL grants/policies follow PostgreSQL's
[privilege rules](https://www.postgresql.org/docs/15/sql-revoke.html).

Consumers must use the revised RPC/projection contracts above. Backend calculation
should use `planning_started`, shared `departure_time`, and explicitly shared
origins; returning member geometry must remain gated on started planning. This
migration does not implement or verify frontend/backend integrations. Proposal
storage keys stay `(room_code,room_revision,venue_id,venue_type)`; no arrival key is
needed. A revision advance requires proposals to be calculated/stored again.

## Verification

`supabase/tests/meeting-voting.sql` is a transaction with synthetic auth identities
and public stations and ends with ROLLBACK. Run as the SQL owner **only in a
disposable local database** with core/auth schema and both migrations already
applied, using `psql -X -v ON_ERROR_STOP=1 -f supabase/tests/meeting-voting.sql` with
an explicitly selected local connection. It is not a cloud smoke test.

Development verification executes the real SQL in ephemeral PGlite PostgreSQL:
full `transit-data.sql`, old meeting schema, this migration, a migration rerun,
and the regression SQL. Auth roles/`auth.uid()` are locally emulated; the old
`pg_cron` extension/scheduler is stubbed because scheduling is outside this change.
Tests cover owner-only RLS, RPC grants, host gates, canonical proposals, first-vote
arrival, stale revisions, 2–2 tie/revote to 2–1–1, invalidations, legacy checks,
nonreused versions, and host transfer (163 SQL statements passed). An additional
isolated upgrade fixture verified that old origins remain private, legacy agreements
and checks reset, an active round survives an exact migration rerun, and a legacy
version 7 becomes version 8 on the next confirmation. Native PostgreSQL multi-connection races,
PostgREST schema cache and Supabase realtime delivery require separate local or
authorized deployment checks; PGlite does not establish those integrations.
