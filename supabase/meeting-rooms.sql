-- Epic 6 — shared meeting rooms.
--
-- Run in the Supabase SQL editor. Safe to re-run: every statement is idempotent.
--
-- A room and its participants are readable only by the people in that room, and a
-- participant row can only be created through join_meeting_room() or create_meeting_room().
-- The room code alone is not what protects the data: without these rules, anyone holding
-- the public key could list every room and every participant's starting point.

-- Keep confirmation, grants and privacy projections atomic on both fresh and existing projects.
begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.meeting_rooms (
  -- No I, L, O, 0 or 1, so a code read aloud or retyped cannot be misread.
  -- Must match CODE_PATTERN in src/features/meeting-point/roomLink.ts.
  code        text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$'),
  -- AC 1.2.1: the fixed budget options.
  time_budget integer not null default 30 check (time_budget in (15, 30, 45, 60)),
  -- A confirmed venue is a canonical public place, never a participant-supplied point.
  -- The JSON shape is produced by resolve_public_meeting_venue() below.
  confirmed_venue jsonb,
  confirmed_arrival_time timestamptz,
  -- Zero means planning. Every changed confirmed agreement gets a new positive version.
  plan_version integer not null default 0 check (plan_version >= 0),
  proposed_arrival_time timestamptz,
  planning_revision bigint not null default 0 check (planning_revision >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours'
);

-- Kept off the realtime room row: a creator id is private metadata, not group state.
create table if not exists public.meeting_room_creators (
  room_code text primary key references public.meeting_rooms (code) on delete cascade,
  user_id uuid references auth.users (id) on delete set null
);

-- Server-produced public venue proposals. The browser cannot write this table; confirmation
-- accepts a changed agreement only while its proposal matches the room's current revision.
create table if not exists public.meeting_plan_proposals (
  room_code text not null references public.meeting_rooms (code) on delete cascade,
  room_revision bigint not null,
  venue_id text not null,
  venue_type text not null check (venue_type in ('station', 'cafe', 'restaurant', 'mall')),
  venue jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  primary key (room_code, room_revision, venue_id, venue_type)
);

create table if not exists public.meeting_participants (
  id         uuid primary key default gen_random_uuid(),
  room_code  text not null references public.meeting_rooms (code) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  nickname   text check (char_length(nickname) between 1 and 30),
  lat        double precision,
  lon        double precision,
  -- Device GPS remains excluded; the selected point is private to its owner and server calculations.
  source     text check (source in ('stop', 'bus-stop', 'place', 'map')),
  label      text check (char_length(label) <= 120),
  arrival_status text not null default 'not_checked'
    check (arrival_status in ('ready', 'check_needed', 'not_checked')),
  checked_plan_version integer check (checked_plan_version is null or checked_plan_version > 0),
  -- Fixed for as long as the participant stays, so a colour follows the person rather than
  -- their position in the list. Must match the palette in participantColours.ts.
  colour_slot smallint not null check (colour_slot between 0 and 5),
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_code, user_id),
  -- A starting point is all or nothing.
  check ((lat is null) = (lon is null) and (lat is null) = (source is null))
);

-- ---------------------------------------------------------------- migrations
-- Bring a project created from an earlier version of this file up to date. Each statement is
-- a no-op on a fresh install.

-- Bus stops became selectable starting points.
alter table public.meeting_participants drop constraint if exists meeting_participants_source_check;
alter table public.meeting_participants
  add constraint meeting_participants_source_check check (source in ('stop', 'bus-stop', 'place', 'map'));

-- Participants gained a fixed colour slot; existing rows are numbered in join order.
alter table public.meeting_participants add column if not exists colour_slot smallint;
update public.meeting_participants p
set colour_slot = numbered.slot
from (
  select id, (row_number() over (partition by room_code order by joined_at) - 1)::smallint as slot
  from public.meeting_participants
  where colour_slot is null
) numbered
where p.id = numbered.id;
alter table public.meeting_participants alter column colour_slot set not null;
alter table public.meeting_participants drop constraint if exists meeting_participants_colour_slot_check;
alter table public.meeting_participants
  add constraint meeting_participants_colour_slot_check check (colour_slot between 0 and 5);
create unique index if not exists meeting_participants_room_colour_slot
  on public.meeting_participants (room_code, colour_slot);

-- MD8-6 confirmation and coarse personal-check status.
-- Preserve creator metadata from the Epic 6 schema before removing it from the shared,
-- realtime-published room row. Dynamic SQL keeps the same file valid on a fresh install.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meeting_rooms' and column_name = 'created_by'
  ) then
    execute $migration$
      insert into public.meeting_room_creators (room_code, user_id)
      select code, created_by from public.meeting_rooms
      on conflict (room_code) do nothing
    $migration$;
    alter table public.meeting_rooms drop column created_by;
  end if;
end $$;

alter table public.meeting_rooms add column if not exists confirmed_venue jsonb;
alter table public.meeting_rooms add column if not exists confirmed_arrival_time timestamptz;
alter table public.meeting_rooms add column if not exists plan_version integer not null default 0;
alter table public.meeting_rooms add column if not exists proposed_arrival_time timestamptz;
alter table public.meeting_rooms add column if not exists planning_revision bigint not null default 0;
alter table public.meeting_rooms add column if not exists updated_at timestamptz not null default now();
alter table public.meeting_rooms drop constraint if exists meeting_rooms_plan_version_check;
alter table public.meeting_rooms
  add constraint meeting_rooms_plan_version_check check (plan_version >= 0);
alter table public.meeting_rooms drop constraint if exists meeting_rooms_planning_revision_check;
alter table public.meeting_rooms
  add constraint meeting_rooms_planning_revision_check check (planning_revision >= 0);
alter table public.meeting_rooms drop constraint if exists meeting_rooms_confirmation_check;
alter table public.meeting_rooms
  add constraint meeting_rooms_confirmation_check check (
    (confirmed_venue is null) = (confirmed_arrival_time is null)
    and (plan_version = 0) = (confirmed_venue is null)
  );

alter table public.meeting_participants
  add column if not exists arrival_status text not null default 'not_checked';
alter table public.meeting_participants add column if not exists checked_plan_version integer;
alter table public.meeting_participants drop constraint if exists meeting_participants_arrival_status_check;
alter table public.meeting_participants
  add constraint meeting_participants_arrival_status_check
  check (arrival_status in ('ready', 'check_needed', 'not_checked'));
alter table public.meeting_participants drop constraint if exists meeting_participants_checked_plan_version_check;
alter table public.meeting_participants
  add constraint meeting_participants_checked_plan_version_check
  check (checked_plan_version is null or checked_plan_version > 0);

-- ---------------------------------------------------------------- functions

-- Security definer so row-level policies can ask "is the caller in this room?" without
-- querying meeting_participants through its own policy, which would recurse.
create or replace function public.is_room_member(p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.meeting_participants p
    join public.meeting_rooms r on r.code = p.room_code
    where p.room_code = p_code
      and p.user_id = auth.uid()
      and r.expires_at > now()
  );
$$;

create or replace function public.create_meeting_room(p_nickname text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  -- Bytes of a v4 UUID that carry no version or variant bits. gen_random_uuid() draws from
  -- a cryptographically strong source; 8 characters of 31 is about 39 bits.
  random_bytes constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  bytes bytea;
  new_code text;
  i int;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  loop
    bytes := uuid_send(gen_random_uuid());
    new_code := '';
    foreach i in array random_bytes loop
      new_code := new_code || substr(alphabet, get_byte(bytes, i) % 31 + 1, 1);
    end loop;
    begin
      insert into public.meeting_rooms (code) values (new_code);
      exit;
    exception when unique_violation then
      -- A collision is vanishingly rare; draw another code.
    end;
  end loop;

  insert into public.meeting_room_creators (room_code, user_id)
  values (new_code, auth.uid());

  insert into public.meeting_participants (room_code, user_id, nickname, colour_slot)
  values (new_code, auth.uid(), nullif(trim(p_nickname), ''), 0);

  return new_code;
end;
$$;

create or replace function public.join_meeting_room(p_code text, p_nickname text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  -- Locking the room serialises concurrent joins, so two people cannot both take the last place.
  select * into room
  from public.meeting_rooms
  where code = upper(trim(p_code)) and expires_at > now()
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  -- Rejoining from the same device keeps the existing place rather than taking a second one.
  if exists (
    select 1 from public.meeting_participants
    where room_code = room.code and user_id = auth.uid()
  ) then
    return;
  end if;

  -- Must match MAX_PARTICIPANTS in src/features/meeting-point/types.ts.
  if (select count(*) from public.meeting_participants where room_code = room.code) >= 6 then
    raise exception 'room_full';
  end if;

  -- The lowest colour slot nobody in the room holds, so a colour freed by someone leaving is
  -- reused instead of everyone who joined later shifting along.
  insert into public.meeting_participants (room_code, user_id, nickname, colour_slot)
  values (
    room.code,
    auth.uid(),
    nullif(trim(p_nickname), ''),
    (
      select min(slot)
      from generate_series(0, 5) as slot
      where slot not in (
        select colour_slot from public.meeting_participants where room_code = room.code
      )
    )
  );

end;
$$;

-- Resolve the caller's selection against public reference data. Confirmation never accepts
-- an arbitrary coordinate, which could otherwise turn a private home into a shared venue.
create or replace function public.resolve_public_meeting_venue(p_venue_id text, p_venue_type text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  venue jsonb;
begin
  if p_venue_type = 'station' and p_venue_id like 'station-%' then
    select jsonb_build_object(
      'id', 'station-' || s.stop_id,
      'type', 'station',
      'name', s.name,
      'kindLabel', 'Rail station',
      'lat', s.latitude,
      'lon', s.longitude
    ) into venue
    from public.transit_stops s
    where s.stop_id = substr(p_venue_id, 9) and s.mode = 'RAIL';
  elsif p_venue_type in ('cafe', 'restaurant', 'mall') then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', s.service_id,
      'type', case
        when s.source_category = 'amenity=cafe' then 'cafe'
        when s.source_category in ('amenity=restaurant', 'amenity=fast_food') then 'restaurant'
        when s.source_category = 'shop=mall' then 'mall'
      end,
      'name', s.name,
      'kindLabel', case
        when s.source_category = 'amenity=cafe' then 'Café'
        when s.source_category = 'amenity=restaurant' then 'Restaurant'
        when s.source_category = 'amenity=fast_food' then 'Fast food'
        when s.source_category = 'shop=mall' then 'Mall'
      end,
      'lat', s.latitude,
      'lon', s.longitude,
      'address', s.address,
      'hours', s.hours
    )) into venue
    from public.essential_services s
    where s.service_id = p_venue_id
      and p_venue_type = case
        when s.source_category = 'amenity=cafe' then 'cafe'
        when s.source_category in ('amenity=restaurant', 'amenity=fast_food') then 'restaurant'
        when s.source_category = 'shop=mall' then 'mall'
      end;
  end if;
  return venue;
end;
$$;

create or replace function public.get_meeting_room_state(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with room as (
    select r.*
    from public.meeting_rooms r
    where r.code = upper(trim(p_code))
      and r.expires_at > now()
      and exists (
        select 1 from public.meeting_participants mine
        where mine.room_code = r.code and mine.user_id = auth.uid()
      )
  ), numbered as (
    select p.*, row_number() over (order by p.joined_at, p.id) as position
    from public.meeting_participants p join room r on r.code = p.room_code
  )
  select jsonb_build_object(
    'room', jsonb_build_object(
      'code', r.code,
      'time_budget', r.time_budget,
      'expires_at', r.expires_at,
      'updated_at', r.updated_at,
      'planning_revision', r.planning_revision,
      'confirmed_venue', r.confirmed_venue,
      'confirmed_arrival_time', r.confirmed_arrival_time,
      'plan_version', r.plan_version,
      'proposed_arrival_time', r.proposed_arrival_time
    ),
    'self', (
      select jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'nickname', p.nickname,
        'lat', p.lat, 'lon', p.lon, 'source', p.source, 'label', p.label,
        'colour_slot', p.colour_slot, 'arrival_status', p.arrival_status,
        'checked_plan_version', p.checked_plan_version
      )
      from numbered p where p.user_id = auth.uid()
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'display_name', coalesce(p.nickname, 'Person ' || p.position),
        'arrival_status', case
          when r.plan_version > 0 and p.checked_plan_version = r.plan_version then
            case p.arrival_status
              when 'ready' then 'Ready'
              when 'check_needed' then 'Check needed'
              else 'Not checked'
            end
          else 'Not checked'
        end,
        'is_self', p.user_id = auth.uid()
      ) order by p.position)
      from numbered p
    ), '[]'::jsonb)
  )
  from room r;
$$;

-- The opaque room code is the invitation capability. A new device may read only the public
-- agreement needed to render that invitation; membership and all participant fields remain
-- behind get_meeting_room_state(). Anonymous sign-in still supplies an authenticated caller.
create or replace function public.get_meeting_invitation(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', r.code,
    'confirmed_venue', r.confirmed_venue,
    'confirmed_arrival_time', r.confirmed_arrival_time,
    'plan_version', r.plan_version
  )
  from public.meeting_rooms r
  where auth.uid() is not null
    and r.code = upper(trim(p_code))
    and r.expires_at > now();
$$;

create or replace function public.confirm_meeting_plan(
  p_code text,
  p_venue jsonb,
  p_arrival_time timestamptz
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  room public.meeting_rooms;
  venue jsonb;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_arrival_time is null
     or p_arrival_time <= now()
     or p_arrival_time > now() + interval '30 days' then
    raise exception 'invalid_arrival_time';
  end if;

  select * into room from public.meeting_rooms
  where code = upper(trim(p_code)) and expires_at > now()
  for update;
  if not found or not public.is_room_member(room.code) then raise exception 'room_not_found'; end if;

  venue := public.resolve_public_meeting_venue(p_venue ->> 'id', p_venue ->> 'type');
  if venue is null then raise exception 'invalid_venue'; end if;

  if room.confirmed_venue is not distinct from venue
     and room.confirmed_arrival_time is not distinct from p_arrival_time then
    return room.plan_version;
  end if;

  if not exists (
    select 1 from public.meeting_plan_proposals proposal
    where proposal.room_code = room.code
      and proposal.room_revision = room.planning_revision
      and proposal.venue_id = venue ->> 'id'
      and proposal.venue_type = venue ->> 'type'
      and proposal.expires_at > now()
  ) then
    raise exception 'stale_meeting_proposal';
  end if;

  next_version := room.plan_version + 1;
  update public.meeting_rooms set
    confirmed_venue = venue,
    confirmed_arrival_time = p_arrival_time,
    plan_version = next_version,
    proposed_arrival_time = null,
    -- A pass must still reopen on the meeting day even when the room was created more
    -- than 24 hours before it. Keep it for one day after the confirmed arrival.
    expires_at = greatest(expires_at, p_arrival_time + interval '24 hours'),
    updated_at = now()
  where code = room.code;
  return next_version;
end;
$$;

create or replace function public.propose_meeting_time(p_code text, p_arrival_time timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_arrival_time is null
     or p_arrival_time <= now()
     or p_arrival_time > now() + interval '30 days' then
    raise exception 'invalid_arrival_time';
  end if;
  update public.meeting_rooms set proposed_arrival_time = p_arrival_time, updated_at = now()
  where code = upper(trim(p_code)) and expires_at > now() and public.is_room_member(code);
  if not found then raise exception 'room_not_found'; end if;
end;
$$;

create or replace function public.set_my_arrival_status(
  p_code text,
  p_status text,
  p_plan_version integer
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_version integer;
begin
  if p_status is null or p_status not in ('ready', 'check_needed', 'not_checked') then
    raise exception 'invalid_arrival_status';
  end if;
  select r.plan_version into current_version
  from public.meeting_rooms r
  join public.meeting_participants p
    on p.room_code = r.code and p.user_id = auth.uid()
  where r.code = upper(trim(p_code)) and r.expires_at > now();
  if current_version is null then raise exception 'room_not_found'; end if;
  if current_version = 0 or p_plan_version is null or p_plan_version <> current_version then
    raise exception 'outdated_plan_version';
  end if;
  update public.meeting_participants set
    arrival_status = p_status,
    checked_plan_version = p_plan_version,
    updated_at = now()
  where room_code = upper(trim(p_code)) and user_id = auth.uid();
  if not found then raise exception 'room_not_found'; end if;
  update public.meeting_rooms set updated_at = now() where code = upper(trim(p_code));
end;
$$;

-- Participant rows are private, so their realtime events are intentionally invisible to
-- other members. A room UPDATE is the shared, non-sensitive invalidation signal.
create or replace function public.touch_meeting_room()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.meeting_rooms set
    updated_at = clock_timestamp(),
    planning_revision = planning_revision + case
      when tg_op in ('INSERT', 'DELETE') then 1
      when (new.lat, new.lon, new.source, new.label)
             is distinct from (old.lat, old.lon, old.source, old.label) then 1
      else 0
    end
  where code = case when tg_op = 'DELETE' then old.room_code else new.room_code end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- A status describes a check from one exact origin. Moving or clearing that origin must
-- immediately make the previous result stale even though the group plan version is unchanged.
create or replace function public.invalidate_moved_participant_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.lat, new.lon, new.source, new.label)
       is distinct from (old.lat, old.lon, old.source, old.label) then
    new.arrival_status := 'not_checked';
    new.checked_plan_version := null;
  end if;
  return new;
end;
$$;

create or replace function public.touch_changed_meeting_budget()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.time_budget is distinct from old.time_budget then
    new.updated_at := clock_timestamp();
    new.planning_revision := old.planning_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_rooms_touch_budget on public.meeting_rooms;
create trigger meeting_rooms_touch_budget
before update of time_budget on public.meeting_rooms
for each row execute function public.touch_changed_meeting_budget();

drop trigger if exists meeting_participants_invalidate_check on public.meeting_participants;
create trigger meeting_participants_invalidate_check
before update of lat, lon, source, label on public.meeting_participants
for each row execute function public.invalidate_moved_participant_check();

drop trigger if exists meeting_participants_touch_room on public.meeting_participants;
create trigger meeting_participants_touch_room
after insert or update or delete on public.meeting_participants
for each row execute function public.touch_meeting_room();

revoke execute on function public.is_room_member(text) from public, anon;
revoke execute on function public.create_meeting_room(text) from public, anon;
revoke execute on function public.join_meeting_room(text, text) from public, anon;
revoke execute on function public.resolve_public_meeting_venue(text, text) from public, anon, authenticated;
revoke execute on function public.get_meeting_room_state(text) from public, anon;
revoke execute on function public.get_meeting_invitation(text) from public, anon;
revoke execute on function public.confirm_meeting_plan(text, jsonb, timestamptz) from public, anon;
revoke execute on function public.propose_meeting_time(text, timestamptz) from public, anon;
revoke execute on function public.set_my_arrival_status(text, text, integer) from public, anon;
revoke execute on function public.touch_meeting_room() from public, anon, authenticated;
revoke execute on function public.invalidate_moved_participant_check() from public, anon, authenticated;
revoke execute on function public.touch_changed_meeting_budget() from public, anon, authenticated;
grant execute on function public.is_room_member(text) to authenticated;
grant execute on function public.create_meeting_room(text) to authenticated;
grant execute on function public.join_meeting_room(text, text) to authenticated;
grant execute on function public.get_meeting_room_state(text) to authenticated;
grant execute on function public.get_meeting_invitation(text) to authenticated;
grant execute on function public.confirm_meeting_plan(text, jsonb, timestamptz) to authenticated;
grant execute on function public.propose_meeting_time(text, timestamptz) to authenticated;
grant execute on function public.set_my_arrival_status(text, text, integer) to authenticated;

-- ---------------------------------------------------------------- access
-- Anonymous sign-ins take the `authenticated` role, so `anon` (no session) gets nothing.

alter table public.meeting_rooms enable row level security;
alter table public.meeting_room_creators enable row level security;
alter table public.meeting_plan_proposals enable row level security;
alter table public.meeting_participants enable row level security;

revoke all on public.meeting_rooms from anon, authenticated;
revoke all on public.meeting_room_creators from anon, authenticated;
revoke all on public.meeting_plan_proposals from anon, authenticated;
revoke all on public.meeting_participants from anon, authenticated;
grant select (
  code, time_budget, confirmed_venue, confirmed_arrival_time, plan_version,
  proposed_arrival_time, planning_revision, created_at, updated_at, expires_at
) on public.meeting_rooms to authenticated;
grant update (time_budget) on public.meeting_rooms to authenticated;
grant select, delete on public.meeting_participants to authenticated;
grant update (nickname, lat, lon, source, label, updated_at) on public.meeting_participants to authenticated;

drop policy if exists "members read their room" on public.meeting_rooms;
create policy "members read their room" on public.meeting_rooms
  for select to authenticated
  using (public.is_room_member(code));

drop policy if exists "members change the budget" on public.meeting_rooms;
create policy "members change the budget" on public.meeting_rooms
  for update to authenticated
  using (public.is_room_member(code))
  with check (public.is_room_member(code));

drop policy if exists "members read each other" on public.meeting_participants;
drop policy if exists "participants read themselves" on public.meeting_participants;
create policy "participants read themselves" on public.meeting_participants
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "participants edit themselves" on public.meeting_participants;
create policy "participants edit themselves" on public.meeting_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "participants leave" on public.meeting_participants;
create policy "participants leave" on public.meeting_participants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- realtime

do $$
begin
  alter publication supabase_realtime add table public.meeting_rooms;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.meeting_participants;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------- expiry

create extension if not exists pg_cron with schema pg_catalog;

-- Hourly; participants go with their room through the cascading foreign key.
select cron.schedule(
  'meeting-rooms-cleanup',
  '0 * * * *',
  $$delete from public.meeting_rooms where expires_at < now()$$
);

commit;
