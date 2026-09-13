-- Epic 6 — shared meeting rooms.
--
-- Run in the Supabase SQL editor. Safe to re-run: every statement is idempotent.
--
-- A room and its participants are readable only by the people in that room, and a
-- participant row can only be created through join_meeting_room() or create_meeting_room().
-- The room code alone is not what protects the data: without these rules, anyone holding
-- the public key could list every room and every participant's starting point.

-- ---------------------------------------------------------------- tables

create table if not exists public.meeting_rooms (
  -- No I, L, O, 0 or 1, so a code read aloud or retyped cannot be misread.
  -- Must match CODE_PATTERN in src/features/meeting-point/roomLink.ts.
  code        text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$'),
  -- AC 1.2.1: the fixed budget options.
  time_budget integer not null default 30 check (time_budget in (15, 30, 45, 60)),
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours'
);

create table if not exists public.meeting_participants (
  id         uuid primary key default gen_random_uuid(),
  room_code  text not null references public.meeting_rooms (code) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  nickname   text check (char_length(nickname) between 1 and 30),
  lat        double precision,
  lon        double precision,
  -- No 'device': a room shares the point with everyone in it.
  source     text check (source in ('stop', 'bus-stop', 'place', 'map')),
  label      text check (char_length(label) <= 120),
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
      insert into public.meeting_rooms (code, created_by) values (new_code, auth.uid());
      exit;
    exception when unique_violation then
      -- A collision is vanishingly rare; draw another code.
    end;
  end loop;

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

revoke execute on function public.is_room_member(text) from public, anon;
revoke execute on function public.create_meeting_room(text) from public, anon;
revoke execute on function public.join_meeting_room(text, text) from public, anon;
grant execute on function public.is_room_member(text) to authenticated;
grant execute on function public.create_meeting_room(text) to authenticated;
grant execute on function public.join_meeting_room(text, text) to authenticated;

-- ---------------------------------------------------------------- access
-- Anonymous sign-ins take the `authenticated` role, so `anon` (no session) gets nothing.

alter table public.meeting_rooms enable row level security;
alter table public.meeting_participants enable row level security;

revoke all on public.meeting_rooms from anon, authenticated;
revoke all on public.meeting_participants from anon, authenticated;
grant select on public.meeting_rooms to authenticated;
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
create policy "members read each other" on public.meeting_participants
  for select to authenticated
  using (public.is_room_member(room_code));

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
