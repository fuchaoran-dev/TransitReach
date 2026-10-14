-- Run ONLY in a disposable local database after both meeting SQL scripts.
-- Synthetic identities/public stations are rolled back; requires the SQL owner.
-- psql -X -v ON_ERROR_STOP=1 <local-connection> -f supabase/tests/meeting-voting.sql
begin;

create temporary table voting_test_users (name text primary key, id uuid not null);
insert into voting_test_users select name, gen_random_uuid()
  from unnest(array['host', 'b', 'c', 'd', 'outsider']) as name;
grant select on voting_test_users to authenticated;
insert into auth.users (id) select id from voting_test_users;
insert into public.transit_stops (stop_id, name, latitude, longitude, mode, source) values
  ('voting-test-a', 'Synthetic station A', 3.1, 101.6, 'RAIL', 'synthetic SQL test'),
  ('voting-test-b', 'Synthetic station B', 3.2, 101.7, 'RAIL', 'synthetic SQL test'),
  ('voting-test-c', 'Synthetic station C', 3.3, 101.8, 'RAIL', 'synthetic SQL test');

create function pg_temp.voting_login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', id::text, true)
    from voting_test_users where name = p_name;
$$;
create function pg_temp.voting_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'assertion failed: %', p_message; end if;
end;
$$;
create function pg_temp.voting_error(p_sql text, p_error text)
returns void language plpgsql as $$
declare
  caught boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_error and sqlstate <> p_error then
      raise exception 'expected %, received % (%)', p_error, sqlerrm, sqlstate;
    end if;
    caught := true;
  end;
  if not caught then raise exception 'expected failure: %', p_error; end if;
end;
$$;
create function pg_temp.voting_code() returns text language sql as $$
  select current_setting('test.meeting_code');
$$;
create function pg_temp.voting_state() returns jsonb language sql as $$
  select public.get_meeting_room_state(pg_temp.voting_code());
$$;
create function pg_temp.voting_revision() returns bigint language sql as $$
  select (pg_temp.voting_state() #>> '{room,planning_revision}')::bigint;
$$;
create function pg_temp.voting_member(p_name text) returns jsonb language sql as $$
  select member from jsonb_array_elements(pg_temp.voting_state() -> 'members') as member
    where member ->> 'display_name' = p_name;
$$;
create function pg_temp.voting_arrival() returns timestamptz language sql as $$
  select current_setting('test.meeting_arrival')::timestamptz;
$$;
create function pg_temp.voting_cast(p_id text) returns jsonb language sql as $$
  -- Extra client coordinates/names must be discarded in favour of canonical data.
  select public.cast_meeting_vote(pg_temp.voting_code(),
    jsonb_build_object('id', p_id, 'type', 'station', 'lat', 0, 'name', 'Forged'),
    pg_temp.voting_arrival(), pg_temp.voting_revision());
$$;
create function pg_temp.voting_selection(p_id text) returns jsonb language sql as $$
  select public.propose_meeting_venue(pg_temp.voting_code(),
    jsonb_build_object('id', p_id, 'type', 'station'), pg_temp.voting_revision());
$$;

select set_config('test.meeting_arrival', (now() + interval '2 hours')::text, true);
set local role authenticated;
select pg_temp.voting_login('host');
select set_config('test.meeting_code', public.create_meeting_room('Host'), true);
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,is_host}')::boolean, 'creator is host');
select pg_temp.voting_error(
  'select public.start_meeting_planning(pg_temp.voting_code(), now()+interval ''1 hour'', pg_temp.voting_arrival())',
  'not_enough_members');
select pg_temp.voting_login('b');
select public.join_meeting_room(pg_temp.voting_code(), 'B');
select pg_temp.voting_login('host');
select pg_temp.voting_error(
  'select public.start_meeting_planning(pg_temp.voting_code(), now()+interval ''1 hour'')', 'origins_not_ready');
select pg_temp.voting_error(
  'select public.share_meeting_origin(pg_temp.voting_code(), ''NaN''::float8, 101, ''device'', ''bad'')',
  'invalid_meeting_origin');
select public.share_meeting_origin(pg_temp.voting_code(), 3.1, 101.6, 'device', 'Chosen device point');
select pg_temp.voting_login('b');
select public.share_meeting_origin(pg_temp.voting_code(), 3.2, 101.7, 'map', 'Chosen map point');
select pg_temp.voting_assert((select count(*) = 1 from public.meeting_participants), 'raw rows owner-only');
select pg_temp.voting_assert(pg_temp.voting_member('Host') ->> 'planning_status' = 'Ready', 'shared origin ready');
select pg_temp.voting_assert(pg_temp.voting_member('Host') ->> 'lat' = '3.1', 'consented coordinates visible');
select pg_temp.voting_assert(not (pg_temp.voting_member('Host') ? 'arrival_status'), 'no personal checks in members');
select pg_temp.voting_assert(position('user_id' in pg_temp.voting_state()::text) = 0, 'projection has no auth identities');
select pg_temp.voting_error(
  'select public.start_meeting_planning(pg_temp.voting_code(), now()+interval ''1 hour'')', 'host_only');
select pg_temp.voting_error('select * from public.meeting_room_creators', '42501');
select pg_temp.voting_error('select * from public.meeting_votes', '42501');
select pg_temp.voting_error('select * from public.meeting_venue_selections', '42501');
select pg_temp.voting_error('select * from public.meeting_plan_proposals', '42501');
select pg_temp.voting_error('update public.meeting_rooms set confirmed_venue = ''{}''', '42501');
select pg_temp.voting_error('update public.meeting_rooms set time_budget = 45', '42501');
select pg_temp.voting_error('select public.set_meeting_budget(pg_temp.voting_code(), 45)', 'host_only');
select pg_temp.voting_error('update public.meeting_participants set lat = 0', '42501');
select pg_temp.voting_error('delete from public.meeting_participants', '42501');
select pg_temp.voting_error(
  'select public.confirm_meeting_plan(pg_temp.voting_code(), ''{"id":"station-voting-test-a","type":"station"}'', pg_temp.voting_arrival())',
  'meeting_votes_required');

select pg_temp.voting_login('c');
select public.join_meeting_room(pg_temp.voting_code(), null);
select public.share_meeting_origin(pg_temp.voting_code(), 3.3, 101.8, 'place', 'Chosen place');
select pg_temp.voting_login('d');
select public.join_meeting_room(pg_temp.voting_code(), 'D');
select public.share_meeting_origin(pg_temp.voting_code(), 3.4, 101.9, 'bus-stop', 'Chosen bus stop');
select pg_temp.voting_login('host');
-- Exercise the two-argument default: arrival must be fixed by the FIRST valid vote.
select public.start_meeting_planning(pg_temp.voting_code(), now() + interval '1 hour');
select set_config('test.first_revision', pg_temp.voting_revision()::text, true);
select pg_temp.voting_assert(pg_temp.voting_state() #> '{room,voting_arrival_time}' = 'null'::jsonb, 'arrival initially absent');
select pg_temp.voting_error('select pg_temp.voting_cast(''station-voting-test-a'')', 'stale_meeting_proposal');
select pg_temp.voting_error('select pg_temp.voting_selection(''station-voting-test-a'')', 'stale_meeting_proposal');
select public.join_meeting_room(pg_temp.voting_code(), 'ignored');
select pg_temp.voting_login('outsider');
select pg_temp.voting_assert(pg_temp.voting_state() is null, 'nonmember projection denied');
select pg_temp.voting_error('select public.join_meeting_room(pg_temp.voting_code(), null)', 'meeting_planning_started');
select pg_temp.voting_error('select pg_temp.voting_cast(''station-voting-test-a'')', 'room_not_found');
reset role;

-- Emulate ONLY the trusted server proposal write (same revision keys as backend).
insert into public.meeting_plan_proposals (room_code, room_revision, venue_id, venue_type, venue)
  select r.code, r.planning_revision, 'station-' || s.stop_id, 'station',
    public.resolve_public_meeting_venue('station-' || s.stop_id, 'station')
  from public.meeting_rooms r cross join public.transit_stops s
  where r.code = pg_temp.voting_code() and s.stop_id like 'voting-test-%';
-- Even the owner cannot write a confirmation without votes: trigger backstop.
select pg_temp.voting_error(
  'update public.meeting_rooms set confirmed_venue = public.resolve_public_meeting_venue(''station-voting-test-a'',''station''), confirmed_arrival_time = pg_temp.voting_arrival(), plan_version = 1 where code = pg_temp.voting_code()',
  'meeting_votes_required');
set local role authenticated;
select pg_temp.voting_login('host');
select pg_temp.voting_selection('station-voting-test-a');
select pg_temp.voting_selection('station-voting-test-b');
select pg_temp.voting_assert(jsonb_array_length(pg_temp.voting_state() -> 'selections') = 1, 'one selection per member');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,voting_arrival_time}')::timestamptz = pg_temp.voting_arrival(), 'first vote fixes arrival');
select pg_temp.voting_assert(pg_temp.voting_revision() = current_setting('test.first_revision')::bigint, 'first vote preserves proposal revision');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{votes,0,venue,name}' = 'Synthetic station A', 'canonical venue ignores forged input');
select pg_temp.voting_login('b');
select pg_temp.voting_error(
  'select public.cast_meeting_vote(pg_temp.voting_code(), ''{"id":"station-voting-test-a","type":"station"}'', pg_temp.voting_arrival()+interval ''1 minute'', pg_temp.voting_revision())',
  'meeting_arrival_time_mismatch');
select pg_temp.voting_error(
  'select public.set_meeting_arrival_time(pg_temp.voting_code(), pg_temp.voting_arrival()+interval ''1 minute'')', 'host_only');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_login('c');
select pg_temp.voting_cast('station-voting-test-b');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{room,vote_status}' = 'waiting', 'wait for everyone despite lead');
select pg_temp.voting_login('d');
select pg_temp.voting_cast('station-voting-test-b');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{room,vote_status}' = 'tie', '2-2 tie stays open');
select pg_temp.voting_cast('station-voting-test-c');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{room,vote_status}' = 'confirmed', '2-1-1 unique plurality finalizes');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{room,confirmed_venue,id}' = 'station-voting-test-a', 'plurality winner');
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,confirmed_arrival_time}')::timestamptz = pg_temp.voting_arrival(), 'one shared arrival');
select pg_temp.voting_assert(jsonb_array_length(pg_temp.voting_state() -> 'votes') = 4, 'one vote per member after change');
select set_config('test.first_version', pg_temp.voting_state() #>> '{room,plan_version}', true);
select public.confirm_meeting_plan(pg_temp.voting_code(), '{"id":"station-voting-test-a","type":"station"}', pg_temp.voting_arrival());
select pg_temp.voting_error('select pg_temp.voting_cast(''station-voting-test-b'')', 'meeting_vote_closed');
select public.set_my_arrival_status(pg_temp.voting_code(), 'ready', current_setting('test.first_version')::integer);
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{self,arrival_status}' = 'ready', 'private legacy check still works');
select pg_temp.voting_assert(not (pg_temp.voting_member('D') ? 'arrival_status'), 'check remains private');
select pg_temp.voting_login('host');
select public.set_meeting_arrival_time(pg_temp.voting_code(), pg_temp.voting_arrival()+interval '1 minute');
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,planning_started}')::boolean, 'arrival edit keeps membership frozen');
select pg_temp.voting_assert(jsonb_array_length(pg_temp.voting_state() -> 'votes') = 0, 'arrival edit invalidates votes');
select pg_temp.voting_assert(jsonb_array_length(pg_temp.voting_state() -> 'selections') = 0, 'arrival edit invalidates selections');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{room,plan_version}' = '0', 'arrival edit invalidates plan');
select pg_temp.voting_login('d');
select pg_temp.voting_assert(pg_temp.voting_state() #>> '{self,arrival_status}' = 'not_checked', 'all checks reset');
select pg_temp.voting_error(
  'select public.cast_meeting_vote(pg_temp.voting_code(), ''{"id":"station-voting-test-a","type":"station"}'', pg_temp.voting_arrival(), current_setting(''test.first_revision'')::bigint)',
  'stale_meeting_revision');
select public.share_meeting_origin(pg_temp.voting_code(), 3.5, 102.0, 'map', 'Moved chosen point');
select pg_temp.voting_assert(not (pg_temp.voting_state() #>> '{room,planning_started}')::boolean, 'origin move unlocks');
select pg_temp.voting_login('host');
select public.start_meeting_planning(pg_temp.voting_code(), now()+interval '1 hour', pg_temp.voting_arrival());
reset role;
insert into public.meeting_plan_proposals (room_code, room_revision, venue_id, venue_type, venue)
  select code, planning_revision, 'station-voting-test-a', 'station',
    public.resolve_public_meeting_venue('station-voting-test-a', 'station')
  from public.meeting_rooms where code = pg_temp.voting_code();
set local role authenticated;
select pg_temp.voting_login('host');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_login('b');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_login('c');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_login('d');
select pg_temp.voting_cast('station-voting-test-a');
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,plan_version}')::integer > current_setting('test.first_version')::integer, 'versions never reused across reset');
select pg_temp.voting_error(
  'select public.set_my_arrival_status(pg_temp.voting_code(), ''ready'', current_setting(''test.first_version'')::integer)',
  'outdated_plan_version');
select pg_temp.voting_login('host');
select pg_temp.voting_error('select public.set_meeting_budget(pg_temp.voting_code(), 20)', 'invalid_meeting_budget');
select public.set_meeting_budget(pg_temp.voting_code(), 45);
select pg_temp.voting_assert(not (pg_temp.voting_state() #>> '{room,planning_started}')::boolean, 'budget unlocks');
select pg_temp.voting_assert(jsonb_array_length(pg_temp.voting_state() -> 'votes') = 0, 'budget resets votes');
select pg_temp.voting_login('host');
select public.start_meeting_planning(pg_temp.voting_code(), now()+interval '1 hour', pg_temp.voting_arrival());
select public.reopen_meeting_planning(pg_temp.voting_code());
select pg_temp.voting_login('outsider');
select public.join_meeting_room(pg_temp.voting_code(), 'New member');
select pg_temp.voting_assert(pg_temp.voting_member('New member') ->> 'planning_status' = 'Not ready', 'new member lacks origin');
select public.share_meeting_origin(pg_temp.voting_code(), 3.6, 102.1, 'map', 'New chosen origin');
select pg_temp.voting_login('host');
select public.start_meeting_planning(pg_temp.voting_code(), now()+interval '1 hour', pg_temp.voting_arrival());
select pg_temp.voting_login('outsider');
select public.leave_meeting_room(pg_temp.voting_code());
select pg_temp.voting_assert(pg_temp.voting_state() is null, 'leaver loses projection');
select pg_temp.voting_login('host');
select pg_temp.voting_assert(not (pg_temp.voting_state() #>> '{room,planning_started}')::boolean, 'leave reopens round');
select public.share_meeting_origin(pg_temp.voting_code(), null, null, null, null);
select pg_temp.voting_assert(pg_temp.voting_member('Host') ->> 'planning_status' = 'Not ready', 'withdrawn consent not ready');
select pg_temp.voting_assert(pg_temp.voting_member('Host') -> 'at' = 'null'::jsonb, 'withdrawn coordinates absent');
select pg_temp.voting_error(
  'select public.start_meeting_planning(pg_temp.voting_code(), now()+interval ''1 hour'', pg_temp.voting_arrival())', 'origins_not_ready');
reset role;
-- Trigger must also recognize the original JWT inside a SECURITY DEFINER call.
select pg_temp.voting_login('b');
select pg_temp.voting_error(
  'update public.meeting_rooms set time_budget = 60 where code = pg_temp.voting_code()', 'host_only');
select set_config('test.successor', (select p.user_id::text from public.meeting_participants p
  where room_code = pg_temp.voting_code() and user_id <> (select id from voting_test_users where name = 'host')
  order by joined_at, id limit 1), true);
set local role authenticated;
select pg_temp.voting_login('host');
select public.leave_meeting_room(pg_temp.voting_code());
select pg_temp.voting_assert(pg_temp.voting_state() is null, 'departing host loses access');
select set_config('request.jwt.claim.sub', current_setting('test.successor'), true);
select pg_temp.voting_assert((pg_temp.voting_state() #>> '{room,is_host}')::boolean, 'earliest remaining member becomes host');
select public.set_meeting_budget(pg_temp.voting_code(), 60);
reset role;
select pg_temp.voting_assert(not exists (
  select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime'
    and tablename in ('meeting_participants', 'meeting_votes', 'meeting_venue_selections')
), 'private tables not realtime published');
set local role anon;
select pg_temp.voting_error('select public.get_meeting_room_state(pg_temp.voting_code())', '42501');
select pg_temp.voting_error('select public.start_meeting_planning(pg_temp.voting_code(), now())', '42501');
reset role;
rollback;
