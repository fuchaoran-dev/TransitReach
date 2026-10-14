-- Apply AFTER meeting-rooms.sql; never reapply the old script after this migration.
-- Browser identities (including Supabase anonymous sign-ins) use authenticated.
begin;

alter table public.meeting_rooms
  add column if not exists planning_started boolean not null default false,
  add column if not exists departure_time timestamptz,
  add column if not exists voting_arrival_time timestamptz,
  -- plan_version must be zero while unconfirmed, but a later plan must not reuse
  -- a version held by a saved personal pass.
  add column if not exists plan_version_counter integer not null default 0;
alter table public.meeting_participants
  add column if not exists origin_shared boolean not null default false;

alter table public.meeting_participants drop constraint if exists meeting_participants_source_check;
alter table public.meeting_participants add constraint meeting_participants_source_check
  check (source in ('stop', 'bus-stop', 'place', 'map', 'device'));
alter table public.meeting_participants drop constraint if exists meeting_participants_shared_origin_check;
alter table public.meeting_participants add constraint meeting_participants_shared_origin_check
  check (not origin_shared or (
    lat is not null and lon is not null and source is not null
    and lat between -90 and 90 and lon between -180 and 180
  ));

create table if not exists public.meeting_votes (
  room_code text not null,
  user_id uuid not null,
  planning_revision bigint not null check (planning_revision >= 0),
  venue jsonb not null,
  arrival_time timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (room_code, user_id),
  foreign key (room_code, user_id)
    references public.meeting_participants (room_code, user_id) on delete cascade,
  check (jsonb_typeof(venue) = 'object'
    and venue ->> 'id' is not null
    and venue ->> 'type' is not null
    and venue ->> 'type' in ('station', 'cafe', 'restaurant', 'mall'))
);

create table if not exists public.meeting_venue_selections (
  room_code text not null,
  user_id uuid not null,
  planning_revision bigint not null check (planning_revision >= 0),
  venue jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_code, user_id),
  foreign key (room_code, user_id)
    references public.meeting_participants (room_code, user_id) on delete cascade,
  check (jsonb_typeof(venue) = 'object' and venue ->> 'id' is not null
    and venue ->> 'type' is not null
    and venue ->> 'type' in ('station', 'cafe', 'restaurant', 'mall'))
);

-- Legacy origins were NOT shared with other members. Keep them private until
-- the owner explicitly calls share_meeting_origin; legacy agreements lack votes.
-- Only the first application resets old rooms; reruns preserve live voting state.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.meeting_rooms'::regclass
      and conname = 'meeting_rooms_voting_workflow_check'
  ) then
    update public.meeting_rooms set
      plan_version_counter = greatest(plan_version_counter, plan_version),
      confirmed_venue = null, confirmed_arrival_time = null, plan_version = 0,
      proposed_arrival_time = null, planning_revision = planning_revision + 1,
      updated_at = clock_timestamp();
    update public.meeting_participants
      set arrival_status = 'not_checked', checked_plan_version = null;
    delete from public.meeting_plan_proposals;
    alter table public.meeting_rooms add constraint meeting_rooms_voting_workflow_check
      check (
        (not planning_started or departure_time is not null)
        and (planning_started or (departure_time is null and voting_arrival_time is null))
        and (voting_arrival_time is null or voting_arrival_time > departure_time)
        and (confirmed_venue is null or planning_started)
        and plan_version_counter >= plan_version
      );
  end if;
end $$;

-- All mutating RPCs lock the room BEFORE touching a participant or vote.
-- Host identity is the existing PRIVATE creator mapping, not a shared room column.
create or replace function public.lock_meeting_voting_room(p_code text, p_host boolean default false)
returns public.meeting_rooms
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into room from public.meeting_rooms
    where code = upper(trim(p_code)) and expires_at > now() for update;
  if not found or not public.is_room_member(room.code) then
    raise exception 'room_not_found';
  end if;
  if p_host and not exists (
    select 1 from public.meeting_room_creators c
    where c.room_code = room.code and c.user_id = auth.uid()
  ) then raise exception 'host_only'; end if;
  return room;
end;
$$;

create or replace function public.require_meeting_origins(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.meeting_participants where room_code = p_code) < 2 then
    raise exception 'not_enough_members';
  end if;
  if exists (
    select 1 from public.meeting_participants where room_code = p_code
      and (not origin_shared or lat is null or lon is null or source is null)
  ) then raise exception 'origins_not_ready'; end if;
end;
$$;

-- Each member must vote, but agreement is a UNIQUE PLURALITY, not unanimity.
-- Group by canonical identity, not a client JSON snapshot or display name.
create or replace function public.meeting_vote_winner(
  p_code text, p_revision bigint, p_arrival_time timestamptz
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with members as (
    select * from public.meeting_participants where room_code = p_code
  ), votes as (
    select v.* from public.meeting_votes v join members m on m.user_id = v.user_id
    where v.room_code = p_code and v.planning_revision = p_revision
      and v.arrival_time = p_arrival_time
  ), tally as (
    select venue ->> 'id' as venue_id, venue ->> 'type' as venue_type, count(*) as total
    from votes group by venue ->> 'id', venue ->> 'type'
  ), leaders as (
    select * from tally where total = (select max(total) from tally)
  )
  select public.resolve_public_meeting_venue(venue_id, venue_type) from leaders
  where (select count(*) from leaders) = 1
    and (select count(*) from members) >= 2
    and not exists (select 1 from members where not origin_shared or lat is null or lon is null)
    and (select count(*) from votes) = (select count(*) from members);
$$;

-- Replace the old budget trigger with one guard for every room update.
-- Confirmation cannot bypass the ballot even if a future grant becomes too broad.
create or replace function public.guard_meeting_voting_room()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  invalidated boolean;
  winner jsonb;
begin
  -- SECURITY DEFINER changes current_user to the owner. Check the JWT caller
  -- instead, also rejecting an authenticated SQL role without a valid subject.
  if new.time_budget is distinct from old.time_budget
    and (auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon'))
    and (not public.is_room_member(old.code) or not exists (
      select 1 from public.meeting_room_creators c
      where c.room_code = old.code and c.user_id = auth.uid()
    )) then raise exception 'host_only'; end if;
  invalidated := new.planning_revision is distinct from old.planning_revision
    or new.time_budget is distinct from old.time_budget
    or new.planning_started is distinct from old.planning_started
    or new.departure_time is distinct from old.departure_time
    or (old.voting_arrival_time is not null
      and new.voting_arrival_time is distinct from old.voting_arrival_time);
  if invalidated then
    new.planning_revision := old.planning_revision + 1;
    new.confirmed_venue := null;
    new.confirmed_arrival_time := null;
    new.plan_version := 0;
    new.proposed_arrival_time := null;
    -- Budget changes require a fresh explicit host start, like origin/member changes.
    if new.time_budget is distinct from old.time_budget then
      new.planning_started := false;
      new.departure_time := null;
      new.voting_arrival_time := null;
    end if;
  end if;
  new.plan_version_counter := old.plan_version_counter;
  if (new.confirmed_venue, new.confirmed_arrival_time, new.plan_version)
      is distinct from (old.confirmed_venue, old.confirmed_arrival_time, old.plan_version)
      and new.confirmed_venue is not null then
    winner := public.meeting_vote_winner(new.code, new.planning_revision, new.voting_arrival_time);
    if not new.planning_started or winner is null
      or new.confirmed_venue is distinct from winner
      or new.confirmed_arrival_time is distinct from new.voting_arrival_time then
      raise exception 'meeting_votes_required';
    end if;
    new.plan_version_counter := old.plan_version_counter + 1;
    new.plan_version := new.plan_version_counter;
  elsif not invalidated and old.confirmed_venue is not null
      and new.confirmed_venue is null then
    raise exception 'reopen_meeting_planning_required';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.clear_invalidated_meeting_round()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.planning_revision is distinct from old.planning_revision then
    delete from public.meeting_votes where room_code = new.code;
    delete from public.meeting_venue_selections where room_code = new.code;
    delete from public.meeting_plan_proposals where room_code = new.code;
  end if;
  if new.planning_revision is distinct from old.planning_revision
      or new.plan_version is distinct from old.plan_version then
    update public.meeting_participants
      set arrival_status = 'not_checked', checked_plan_version = null, updated_at = now()
      where room_code = new.code
        and (arrival_status <> 'not_checked' or checked_plan_version is not null);
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_rooms_touch_budget on public.meeting_rooms;
drop trigger if exists meeting_rooms_guard_voting on public.meeting_rooms;
create trigger meeting_rooms_guard_voting before update on public.meeting_rooms
  for each row execute function public.guard_meeting_voting_room();
drop trigger if exists meeting_rooms_clear_round on public.meeting_rooms;
create trigger meeting_rooms_clear_round after update on public.meeting_rooms
  for each row execute function public.clear_invalidated_meeting_round();

create or replace function public.touch_meeting_room()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  changed boolean;
  changed_code text;
begin
  if tg_op = 'DELETE' then
    changed_code := old.room_code;
    changed := true;
  elsif tg_op = 'INSERT' then
    changed_code := new.room_code;
    changed := true;
  else
    changed_code := new.room_code;
    changed := (new.lat, new.lon, new.source, new.label, new.origin_shared)
      is distinct from (old.lat, old.lon, old.source, old.label, old.origin_shared);
  end if;
  if changed then
    update public.meeting_rooms set planning_revision = planning_revision + 1,
      planning_started = false, departure_time = null, voting_arrival_time = null
      where meeting_rooms.code = changed_code;
  else
    update public.meeting_rooms set updated_at = clock_timestamp()
      where meeting_rooms.code = changed_code;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Backstop for trusted SQL writers too. Leaving remains allowed and reopens the
-- room; a frozen round's membership is never silently reduced for the tally.
create or replace function public.guard_meeting_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  started boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.room_code, new.user_id, new.colour_slot, new.joined_at)
      is distinct from (old.id, old.room_code, old.user_id, old.colour_slot, old.joined_at) then
      raise exception 'immutable_meeting_membership';
    end if;
    return new;
  end if;
  select planning_started into started from public.meeting_rooms
    where code = new.room_code for update;
  if started then raise exception 'meeting_planning_started'; end if;
  return new;
end;
$$;
drop trigger if exists meeting_participants_guard_membership on public.meeting_participants;
create trigger meeting_participants_guard_membership
  before insert or update on public.meeting_participants
  for each row execute function public.guard_meeting_membership();

create or replace function public.join_meeting_room(p_code text, p_nickname text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into room from public.meeting_rooms
    where code = upper(trim(p_code)) and expires_at > now() for update;
  if not found then raise exception 'room_not_found'; end if;
  -- Existing members may open their invitation during a frozen round.
  if exists (select 1 from public.meeting_participants
    where room_code = room.code and user_id = auth.uid()) then return; end if;
  if room.planning_started then raise exception 'meeting_planning_started'; end if;
  if (select count(*) from public.meeting_participants where room_code = room.code) >= 6 then
    raise exception 'room_full';
  end if;
  insert into public.meeting_participants (room_code, user_id, nickname, colour_slot)
    values (room.code, auth.uid(), nullif(trim(p_nickname), ''), (
      select min(slot) from generate_series(0, 5) as slot
      where slot not in (select colour_slot from public.meeting_participants where room_code = room.code)
    ));
  -- An empty room has no successor when its last host leaves. Its first new
  -- member becomes host; this never replaces an existing creator mapping.
  update public.meeting_room_creators set user_id = (
    select p.user_id from public.meeting_participants p
    where p.room_code = room.code order by p.joined_at, p.id limit 1
  ) where room_code = room.code and user_id is null;
end;
$$;

-- This RPC is the explicit consent action, including a user-selected device point.
-- All four nullable origin fields null withdraws consent and clears the point.
create or replace function public.share_meeting_origin(
  p_code text, p_lat double precision, p_lon double precision, p_source text, p_label text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  clearing boolean;
begin
  room := public.lock_meeting_voting_room(p_code);
  clearing := p_lat is null and p_lon is null and p_source is null and p_label is null;
  if not clearing and (
    p_lat is null or p_lon is null or p_source is null
    or not (p_lat between -90 and 90) or not (p_lon between -180 and 180)
    or p_source not in ('stop', 'bus-stop', 'place', 'map', 'device')
    or char_length(p_label) > 120
  ) then raise exception 'invalid_meeting_origin'; end if;
  update public.meeting_participants set lat = p_lat, lon = p_lon,
    source = p_source, label = p_label, origin_shared = not clearing, updated_at = now()
    where room_code = room.code and user_id = auth.uid();
end;
$$;

create or replace function public.leave_meeting_room(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  room := public.lock_meeting_voting_room(p_code);
  -- Transfer BEFORE removing the host, under the same room lock as voting/join.
  -- Keep the user id in the private mapping; clients observe only is_host.
  update public.meeting_room_creators set user_id = (
    select p.user_id from public.meeting_participants p
    where p.room_code = room.code and p.user_id <> auth.uid()
    order by p.joined_at, p.id limit 1
  ) where room_code = room.code and user_id = auth.uid();
  delete from public.meeting_participants where room_code = room.code and user_id = auth.uid();
end;
$$;

create or replace function public.set_meeting_budget(p_code text, p_budget integer)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code, true);
  if p_budget is null or p_budget not in (15, 30, 45, 60) then
    raise exception 'invalid_meeting_budget';
  end if;
  if p_budget = room.time_budget then return room.planning_revision; end if;
  update public.meeting_rooms set time_budget = p_budget where code = room.code
    returning planning_revision into revision;
  return revision;
end;
$$;

create or replace function public.set_meeting_nickname(p_code text, p_nickname text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  room := public.lock_meeting_voting_room(p_code);
  update public.meeting_participants set nickname = nullif(trim(p_nickname), ''), updated_at = now()
    where room_code = room.code and user_id = auth.uid();
end;
$$;

-- Two arguments allow the first vote to choose arrival; three set it up front.
-- There is just one SQL signature (with a default), avoiding PostgREST ambiguity.
create or replace function public.start_meeting_planning(
  p_code text, p_departure_time timestamptz, p_arrival_time timestamptz default null
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code, true);
  if room.planning_started then raise exception 'meeting_planning_started'; end if;
  perform public.require_meeting_origins(room.code);
  if p_departure_time is null or p_departure_time <= now()
    or p_departure_time > now() + interval '30 days' then
    raise exception 'invalid_departure_time';
  end if;
  if p_arrival_time is not null and (
    p_arrival_time <= p_departure_time or p_arrival_time > now() + interval '30 days'
  ) then raise exception 'invalid_arrival_time'; end if;
  update public.meeting_rooms set planning_started = true, departure_time = p_departure_time,
    voting_arrival_time = p_arrival_time, planning_revision = planning_revision + 1
    where code = room.code returning planning_revision into revision;
  return revision;
end;
$$;

create or replace function public.reopen_meeting_planning(p_code text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code, true);
  update public.meeting_rooms set planning_started = false, departure_time = null,
    voting_arrival_time = null, planning_revision = planning_revision + 1
    where code = room.code returning planning_revision into revision;
  return revision;
end;
$$;

create or replace function public.set_meeting_arrival_time(p_code text, p_arrival_time timestamptz)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code, true);
  if not room.planning_started then raise exception 'meeting_planning_not_started'; end if;
  perform public.require_meeting_origins(room.code);
  if p_arrival_time is null or p_arrival_time <= now() or p_arrival_time <= room.departure_time
    or p_arrival_time > now() + interval '30 days' then
    raise exception 'invalid_arrival_time';
  end if;
  if p_arrival_time is not distinct from room.voting_arrival_time then return room.planning_revision; end if;
  update public.meeting_rooms set voting_arrival_time = p_arrival_time,
    planning_revision = planning_revision + 1 where code = room.code
    returning planning_revision into revision;
  return revision;
end;
$$;

create or replace function public.cast_meeting_vote(
  p_code text, p_venue jsonb, p_arrival_time timestamptz, p_revision bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  canonical_venue jsonb;
  winner jsonb;
begin
  room := public.lock_meeting_voting_room(p_code);
  if not room.planning_started then raise exception 'meeting_planning_not_started'; end if;
  if p_revision is null or p_revision <> room.planning_revision then
    raise exception 'stale_meeting_revision';
  end if;
  perform public.require_meeting_origins(room.code);
  if p_arrival_time is null or p_arrival_time <= now() or p_arrival_time <= room.departure_time
    or p_arrival_time > now() + interval '30 days' then
    raise exception 'invalid_arrival_time';
  end if;
  if room.voting_arrival_time is not null and p_arrival_time <> room.voting_arrival_time then
    raise exception 'meeting_arrival_time_mismatch';
  end if;
  if room.confirmed_venue is not null then raise exception 'meeting_vote_closed'; end if;
  canonical_venue := public.resolve_public_meeting_venue(p_venue ->> 'id', p_venue ->> 'type');
  if canonical_venue is null then raise exception 'invalid_venue'; end if;
  if not exists (
    select 1 from public.meeting_plan_proposals proposal
    where proposal.room_code = room.code and proposal.room_revision = room.planning_revision
      and proposal.venue_id = canonical_venue ->> 'id'
      and proposal.venue_type = canonical_venue ->> 'type' and proposal.expires_at > now()
  ) then raise exception 'stale_meeting_proposal'; end if;
  if room.voting_arrival_time is null then
    update public.meeting_rooms set voting_arrival_time = p_arrival_time where code = room.code;
  end if;
  insert into public.meeting_votes (room_code, user_id, planning_revision, venue, arrival_time)
    values (room.code, auth.uid(), room.planning_revision, canonical_venue, p_arrival_time)
    on conflict (room_code, user_id) do update set
      planning_revision = excluded.planning_revision, venue = excluded.venue,
      arrival_time = excluded.arrival_time, updated_at = now();
  winner := public.meeting_vote_winner(room.code, room.planning_revision, p_arrival_time);
  if winner is not null then
    update public.meeting_rooms set confirmed_venue = winner,
      confirmed_arrival_time = p_arrival_time, plan_version = plan_version_counter + 1,
      proposed_arrival_time = null,
      expires_at = greatest(expires_at, p_arrival_time + interval '24 hours')
      where code = room.code;
  else
    -- A removed public reference is a data failure, not a tied ballot.
    if (select count(*) from public.meeting_votes
        where room_code = room.code and planning_revision = room.planning_revision)
        = (select count(*) from public.meeting_participants where room_code = room.code)
      and (with tally as (
        select count(*) as total from public.meeting_votes
        where room_code = room.code and planning_revision = room.planning_revision
        group by venue ->> 'id', venue ->> 'type'
      ) select count(*) from tally where total = (select max(total) from tally)) = 1 then
      raise exception 'meeting_venue_unavailable';
    end if;
    update public.meeting_rooms set updated_at = clock_timestamp() where code = room.code;
  end if;
  return public.get_meeting_room_state(room.code);
end;
$$;

-- A shared shortlist selection is not a ballot and cannot finalize an agreement.
create or replace function public.propose_meeting_venue(p_code text, p_venue jsonb, p_revision bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  canonical_venue jsonb;
begin
  room := public.lock_meeting_voting_room(p_code);
  if not room.planning_started then raise exception 'meeting_planning_not_started'; end if;
  if p_revision is null or p_revision <> room.planning_revision then
    raise exception 'stale_meeting_revision';
  end if;
  perform public.require_meeting_origins(room.code);
  if room.confirmed_venue is not null then raise exception 'meeting_vote_closed'; end if;
  canonical_venue := public.resolve_public_meeting_venue(p_venue ->> 'id', p_venue ->> 'type');
  if canonical_venue is null then raise exception 'invalid_venue'; end if;
  if not exists (
    select 1 from public.meeting_plan_proposals proposal
    where proposal.room_code = room.code and proposal.room_revision = room.planning_revision
      and proposal.venue_id = canonical_venue ->> 'id'
      and proposal.venue_type = canonical_venue ->> 'type' and proposal.expires_at > now()
  ) then raise exception 'stale_meeting_proposal'; end if;
  insert into public.meeting_venue_selections (room_code, user_id, planning_revision, venue)
    values (room.code, auth.uid(), room.planning_revision, canonical_venue)
    on conflict (room_code, user_id) do update set
      planning_revision = excluded.planning_revision, venue = excluded.venue, updated_at = now();
  update public.meeting_rooms set updated_at = clock_timestamp() where code = room.code;
  return public.get_meeting_room_state(room.code);
end;
$$;

-- Compatibility RPC: cannot create/replace an agreement; only acknowledges the
-- exact agreement already auto-finalized by a complete, unique-plurality ballot.
create or replace function public.confirm_meeting_plan(p_code text, p_venue jsonb, p_arrival_time timestamptz)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  winner jsonb;
begin
  room := public.lock_meeting_voting_room(p_code);
  winner := public.meeting_vote_winner(room.code, room.planning_revision, room.voting_arrival_time);
  if not room.planning_started or winner is null or room.confirmed_venue is distinct from winner
    or room.confirmed_arrival_time is distinct from p_arrival_time
    or p_arrival_time is distinct from room.voting_arrival_time
    or public.resolve_public_meeting_venue(p_venue ->> 'id', p_venue ->> 'type') is distinct from winner then
    raise exception 'meeting_votes_required';
  end if;
  return room.plan_version;
end;
$$;

-- Old clients must not create a second, member-controlled clock.
create or replace function public.propose_meeting_time(p_code text, p_arrival_time timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.set_meeting_arrival_time(p_code, p_arrival_time);
end;
$$;

-- Lock before verifying the version so a concurrent reopen cannot resurrect a check.
create or replace function public.set_my_arrival_status(p_code text, p_status text, p_plan_version integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  room := public.lock_meeting_voting_room(p_code);
  if p_status is null or p_status not in ('ready', 'check_needed', 'not_checked') then
    raise exception 'invalid_arrival_status';
  end if;
  if room.plan_version = 0 or p_plan_version is null or p_plan_version <> room.plan_version then
    raise exception 'outdated_plan_version';
  end if;
  update public.meeting_participants set arrival_status = p_status,
    checked_plan_version = p_plan_version, updated_at = now()
    where room_code = room.code and user_id = auth.uid();
end;
$$;

create or replace function public.get_meeting_room_state(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with room as (
    select r.* from public.meeting_rooms r
    where r.code = upper(trim(p_code)) and r.expires_at > now()
      and public.is_room_member(r.code)
  ), members as (
    select p.*, row_number() over (order by p.joined_at, p.id) as position
      from public.meeting_participants p join room r on r.code = p.room_code
  ), votes as (
    select v.*, m.id as member_id, coalesce(m.nickname, 'Person ' || m.position) as display_name,
      m.position from public.meeting_votes v join members m on m.user_id = v.user_id
      join room r on r.code = v.room_code
      where v.planning_revision = r.planning_revision and v.arrival_time = r.voting_arrival_time
  ), selections as (
    select s.venue, m.id as member_id, coalesce(m.nickname, 'Person ' || m.position) as display_name,
      m.position from public.meeting_venue_selections s join members m on m.user_id = s.user_id
      join room r on r.code = s.room_code where s.planning_revision = r.planning_revision
  ), tally as (
    select count(*) as total from votes group by venue ->> 'id', venue ->> 'type'
  )
  select jsonb_build_object(
    'room', jsonb_build_object(
      'code', r.code, 'time_budget', r.time_budget, 'expires_at', r.expires_at,
      'updated_at', r.updated_at, 'planning_revision', r.planning_revision,
      'planning_started', r.planning_started, 'departure_time', r.departure_time,
      'voting_arrival_time', r.voting_arrival_time,
      'vote_status', case when r.confirmed_venue is not null then 'confirmed'
        when r.planning_started and (select count(*) from members) >= 2
          and (select count(*) from votes) = (select count(*) from members)
          and (select count(*) from tally where total = (select max(total) from tally)) > 1
        then 'tie' else 'waiting' end,
      'is_host', exists (select 1 from public.meeting_room_creators c
        where c.room_code = r.code and c.user_id = auth.uid()),
      'confirmed_venue', r.confirmed_venue, 'confirmed_arrival_time', r.confirmed_arrival_time,
      'plan_version', r.plan_version, 'proposed_arrival_time', r.proposed_arrival_time
    ),
    -- Full private row remains available via owner-only RLS SELECT; the RPC has
    -- no auth user IDs anywhere, including its self projection.
    'self', (select to_jsonb(m) - 'user_id' - 'position' from members m where m.user_id = auth.uid()),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'display_name', coalesce(m.nickname, 'Person ' || m.position),
      'is_self', m.user_id = auth.uid(), 'colour_slot', m.colour_slot,
      'lat', case when m.origin_shared then m.lat end,
      'lon', case when m.origin_shared then m.lon end,
      'at', case when m.origin_shared then jsonb_build_object('lat', m.lat, 'lon', m.lon) end,
      'label', case when m.origin_shared then m.label end,
      'planning_status', case when m.origin_shared and m.lat is not null and m.lon is not null
        then 'Ready' else 'Not ready' end
    ) order by m.position) from members m), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object(
      'member_id', v.member_id, 'display_name', v.display_name,
      'venue', v.venue, 'arrival_time', v.arrival_time
    ) order by v.position) from votes v), '[]'::jsonb),
    'selections', coalesce((select jsonb_agg(jsonb_build_object(
      'member_id', s.member_id, 'display_name', s.display_name, 'venue', s.venue
    ) order by s.position) from selections s), '[]'::jsonb)
  ) from room r;
$$;

-- No direct writes: this is both a consent boundary and the common room-first
-- lock order. Keep full owner-only participant SELECT; budget is a host RPC.
revoke all on public.meeting_participants from public, anon, authenticated;
grant select on public.meeting_participants to authenticated;
revoke all on public.meeting_votes from public, anon, authenticated;
alter table public.meeting_votes enable row level security;
revoke all on public.meeting_venue_selections from public, anon, authenticated;
alter table public.meeting_venue_selections enable row level security;
-- No vote SELECT policy: expose names/member IDs only through the safe RPC.
revoke all on public.meeting_room_creators from public, anon, authenticated;
revoke all on public.meeting_plan_proposals from public, anon, authenticated;
revoke all on public.meeting_rooms from public, anon, authenticated;
grant select (
  code, time_budget, confirmed_venue, confirmed_arrival_time, plan_version,
  proposed_arrival_time, planning_revision, created_at, updated_at, expires_at,
  planning_started, departure_time, voting_arrival_time
) on public.meeting_rooms to authenticated;

-- Remove participant realtime publication: DELETE events may carry a primary
-- key even where SELECT RLS is private. The non-sensitive room is the signal.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_participants') then
    alter publication supabase_realtime drop table public.meeting_participants;
  end if;
end $$;

revoke execute on function public.lock_meeting_voting_room(text, boolean) from public, anon, authenticated;
revoke execute on function public.require_meeting_origins(text) from public, anon, authenticated;
revoke execute on function public.meeting_vote_winner(text, bigint, timestamptz) from public, anon, authenticated;
revoke execute on function public.guard_meeting_voting_room() from public, anon, authenticated;
revoke execute on function public.clear_invalidated_meeting_round() from public, anon, authenticated;
revoke execute on function public.guard_meeting_membership() from public, anon, authenticated;
revoke execute on function public.share_meeting_origin(text, double precision, double precision, text, text) from public, anon;
revoke execute on function public.leave_meeting_room(text) from public, anon;
revoke execute on function public.set_meeting_nickname(text, text) from public, anon;
revoke execute on function public.start_meeting_planning(text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.reopen_meeting_planning(text) from public, anon;
revoke execute on function public.set_meeting_arrival_time(text, timestamptz) from public, anon;
revoke execute on function public.cast_meeting_vote(text, jsonb, timestamptz, bigint) from public, anon;
revoke execute on function public.propose_meeting_venue(text, jsonb, bigint) from public, anon;
revoke execute on function public.set_meeting_budget(text, integer) from public, anon;
grant execute on function public.share_meeting_origin(text, double precision, double precision, text, text) to authenticated;
grant execute on function public.leave_meeting_room(text) to authenticated;
grant execute on function public.set_meeting_nickname(text, text) to authenticated;
grant execute on function public.start_meeting_planning(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.reopen_meeting_planning(text) to authenticated;
grant execute on function public.set_meeting_arrival_time(text, timestamptz) to authenticated;
grant execute on function public.cast_meeting_vote(text, jsonb, timestamptz, bigint) to authenticated;
grant execute on function public.propose_meeting_venue(text, jsonb, bigint) to authenticated;
grant execute on function public.set_meeting_budget(text, integer) to authenticated;

commit;
