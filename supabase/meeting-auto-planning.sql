-- Apply after meeting-voting.sql. No room reset; existing agreements are preserved.
begin;

alter table public.meeting_rooms add column if not exists meeting_time timestamptz;
update public.meeting_rooms set meeting_time =
  coalesce(voting_arrival_time, confirmed_arrival_time, now() + interval '90 minutes')
  where meeting_time is null;
alter table public.meeting_rooms alter column meeting_time set default (now() + interval '90 minutes');
alter table public.meeting_rooms alter column meeting_time set not null;

-- Room-first locking in all member RPCs serializes readiness, membership and ballots.
-- Internal trigger: it never starts a partial group or invents a new time for an expired one.
create or replace function public.auto_prepare_meeting_round()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.planning_started or new.confirmed_venue is not null or new.expires_at <= now()
    or new.meeting_time - make_interval(mins => new.time_budget) <= now()
    or new.meeting_time > now() + interval '30 days'
    or (select count(*) from public.meeting_participants where room_code = new.code) < 2
    or exists (select 1 from public.meeting_participants where room_code = new.code
      and (not origin_shared or lat is null or lon is null or source is null))
  then return new; end if;
  update public.meeting_rooms set planning_started = true,
    departure_time = meeting_time - make_interval(mins => time_budget),
    voting_arrival_time = meeting_time, planning_revision = planning_revision + 1
    where code = new.code and not planning_started;
  return new;
end;
$$;
-- Runs after the existing clear-round trigger; the nested update is already started.
drop trigger if exists meeting_rooms_z_auto_prepare on public.meeting_rooms;
create trigger meeting_rooms_z_auto_prepare after update on public.meeting_rooms
  for each row when (not new.planning_started)
  execute function public.auto_prepare_meeting_round();

create or replace function public.ensure_meeting_planning(p_code text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare room public.meeting_rooms; revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code);
  if not room.planning_started then
    -- No start authority or timing parameters are delegated to the caller.
    update public.meeting_rooms set updated_at = clock_timestamp() where code = room.code;
  end if;
  select planning_revision into revision from public.meeting_rooms where code = room.code;
  return revision;
end;
$$;

create or replace function public.set_meeting_time(p_code text, p_arrival_time timestamptz)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare room public.meeting_rooms; revision bigint;
begin
  room := public.lock_meeting_voting_room(p_code, true);
  if p_arrival_time is null
    or p_arrival_time - make_interval(mins => room.time_budget) <= now()
    or p_arrival_time > now() + interval '30 days'
  then raise exception 'invalid_arrival_time'; end if;
  if p_arrival_time = room.meeting_time then return room.planning_revision; end if;
  update public.meeting_rooms set meeting_time = p_arrival_time,
    planning_started = false, departure_time = null, voting_arrival_time = null,
    planning_revision = planning_revision + 1 where code = room.code;
  select planning_revision into revision from public.meeting_rooms where code = room.code;
  return revision;
end;
$$;

-- Auto-start must not prevent the third member from joining a two-ready-member room.
-- A confirmed agreement still requires the host to reopen before accepting new members.
create or replace function public.guard_meeting_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare confirmed jsonb;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.room_code, new.user_id, new.colour_slot, new.joined_at)
      is distinct from (old.id, old.room_code, old.user_id, old.colour_slot, old.joined_at)
    then raise exception 'immutable_meeting_membership'; end if;
    return new;
  end if;
  select confirmed_venue into confirmed from public.meeting_rooms
    where code = new.room_code for update;
  if confirmed is not null then raise exception 'meeting_planning_started'; end if;
  return new;
end;
$$;

create or replace function public.join_meeting_room(p_code text, p_nickname text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare room public.meeting_rooms;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into room from public.meeting_rooms
    where code = upper(trim(p_code)) and expires_at > now() for update;
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.meeting_participants
    where room_code = room.code and user_id = auth.uid()) then return; end if;
  if room.confirmed_venue is not null then raise exception 'meeting_planning_started'; end if;
  if (select count(*) from public.meeting_participants where room_code = room.code) >= 6
    then raise exception 'room_full'; end if;
  insert into public.meeting_participants (room_code, user_id, nickname, colour_slot)
    values (room.code, auth.uid(), nullif(trim(p_nickname), ''), (
      select min(slot) from generate_series(0, 5) as slot
      where slot not in (select colour_slot from public.meeting_participants where room_code = room.code)
    ));
  update public.meeting_room_creators set user_id = (
    select p.user_id from public.meeting_participants p
    where p.room_code = room.code order by p.joined_at, p.id limit 1
  ) where room_code = room.code and user_id is null;
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
      'voting_arrival_time', r.voting_arrival_time, 'meeting_time', r.meeting_time,
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

grant select (meeting_time) on public.meeting_rooms to authenticated;
revoke execute on function public.auto_prepare_meeting_round() from public, anon, authenticated;
revoke execute on function public.ensure_meeting_planning(text) from public, anon;
revoke execute on function public.set_meeting_time(text, timestamptz) from public, anon;
grant execute on function public.ensure_meeting_planning(text) to authenticated;
grant execute on function public.set_meeting_time(text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
