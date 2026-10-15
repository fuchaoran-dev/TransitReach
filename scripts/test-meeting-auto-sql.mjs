// Opt-in ephemeral PostgreSQL WASM test. No cloud, env.local, disk database or real identities.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

if (!process.env.TEST_PGLITE_MODULE) throw new Error('Set TEST_PGLITE_MODULE to an installed @electric-sql/pglite module; no package is downloaded automatically.');
const { PGlite } = await import(process.env.TEST_PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const peer = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
const actor = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
const owner = async () => { await db.exec('reset role'); };
const row = async sql => (await db.query(sql)).rows[0];
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create publication supabase_realtime;
    create table public.transit_stops(stop_id text,name text,latitude double precision,longitude double precision,mode text);
    create table public.essential_services(service_id text,source_category text,name text,latitude double precision,longitude double precision,address text,hours text);
    insert into public.transit_stops values('a','Synthetic station',3.1,101.6,'RAIL');`);
  for (const id of [a, b, peer, outsider]) await db.query('insert into auth.users values($1)', [id]);
  // Only pg_cron's scheduler setup is omitted; room tables, RLS, RPCs and triggers are real SQL.
  const rooms = readFileSync('supabase/meeting-rooms.sql', 'utf8');
  await db.exec(rooms.slice(0, rooms.indexOf('-- ---------------------------------------------------------------- expiry')) + 'commit;');
  await db.exec(readFileSync('supabase/meeting-voting.sql', 'utf8'));
  const migration = readFileSync('supabase/meeting-auto-planning.sql', 'utf8');
  await db.exec(migration);
  await actor(a);
  const code = (await db.query("select public.create_meeting_room('Local A') as code")).rows[0].code;
  const state = async () => (await db.query('select public.get_meeting_room_state($1) as state', [code])).rows[0].state;
  const share = async (lat, lon) => db.query("select public.share_meeting_origin($1,$2,$3,'map','Synthetic point')", [code, lat, lon]);
  check((await state()).room.planning_started, false);
  await share(3.1, 101.6);
  check((await state()).room.planning_started, false);
  await actor(b); await db.query("select public.join_meeting_room($1,'Local B')", [code]);
  check((await state()).room.planning_started, false);
  await share(3.11, 101.61);
  let current = await state();
  check(current.room.planning_started, true);
  check(current.members.every(member => member.planning_status === 'Ready'), true);
  check(Date.parse(current.room.voting_arrival_time) - Date.parse(current.room.departure_time), 30 * 60_000);
  const revision = current.room.planning_revision;
  await db.query('select public.ensure_meeting_planning($1)', [code]);
  check((await state()).room.planning_revision, revision);
  await assert.rejects(db.query("select public.set_meeting_time($1,now()+interval '1 day')", [code]), /host_only/); checks++;
  await actor(a); await db.query("select public.set_meeting_time($1,now()+interval '1 day')", [code]);
  const target = (await state()).room.meeting_time;
  await actor(b); await share(3.12, 101.62);
  current = await state();
  check(current.room.planning_started, true);
  check(current.room.meeting_time, target);
  check(current.room.voting_arrival_time, target);
  check(current.room.planning_revision > revision, true);
  // A third unready member may join the automatically prepared, unconfirmed group.
  await actor(peer); await db.query("select public.join_meeting_room($1,'Local C')", [code]);
  check((await state()).room.planning_started, false);
  await share(3.13, 101.63); check((await state()).room.planning_started, true);
  // Withdrawal must wait, never draw or validate a partial group.
  await db.query('select public.share_meeting_origin($1,null,null,null,null)', [code]);
  current = await state(); check(current.room.planning_started, false);
  check(current.members.filter(member => member.planning_status === 'Ready').length, 2);
  await actor(outsider);
  check(await state(), null);
  await assert.rejects(db.query('select public.ensure_meeting_planning($1)', [code]), /room_not_found/); checks++;
  // Check caller roles cannot directly change the new schedule or invoke the trigger helper.
  await owner();
  check((await row("select has_function_privilege('anon','public.ensure_meeting_planning(text)','EXECUTE') as allowed")).allowed, false);
  check((await row("select has_function_privilege('authenticated','public.auto_prepare_meeting_round()','EXECUTE') as allowed")).allowed, false);
  check((await row("select has_column_privilege('authenticated','public.meeting_rooms','meeting_time','UPDATE') as allowed")).allowed, false);
  check((await row("select has_column_privilege('authenticated','public.meeting_rooms','meeting_time','SELECT') as allowed")).allowed, true);
  await actor(peer); await share(3.13, 101.63);
  await owner(); await db.exec(migration);
  await actor(peer); current = await state();
  check(current.room.meeting_time, target); check(current.room.planning_started, true);
  // Populate canonical server proposal, vote, then verify a nonhost origin change clears it.
  await owner();
  const canonical = (await db.query("select public.resolve_public_meeting_venue('station-a','station') as venue")).rows[0].venue;
  const activeRevision = current.room.planning_revision;
  await owner(); await db.query('insert into public.meeting_plan_proposals(room_code,room_revision,venue_id,venue_type,venue) values($1,$2,$3,$4,$5)', [code, activeRevision, 'station-a', 'station', canonical]);
  for (const id of [a, b, peer]) {
    await actor(id); await db.query('select public.cast_meeting_vote($1,$2,$3,$4)', [code, canonical, target, activeRevision]);
  }
  current = await state(); check(current.room.vote_status, 'confirmed');
  const planVersion = current.room.plan_version;
  await owner(); await db.exec(migration); await actor(peer);
  check((await state()).room.plan_version, planVersion);
  await actor(outsider); await assert.rejects(db.query("select public.join_meeting_room($1,'Local outsider')", [code]), /meeting_planning_started/); checks++;
  await actor(b); await share(3.14, 101.64);
  current = await state();
  check(current.room.planning_started, true); check(current.room.confirmed_venue, null);
  check(current.votes.length, 0); check(current.selections.length, 0); check(current.room.meeting_time, target);
  await actor(a); await db.query('select public.set_meeting_budget($1,45)', [code]);
  current = await state(); check(current.room.planning_started, true);
  check(Date.parse(current.room.voting_arrival_time) - Date.parse(current.room.departure_time), 45 * 60_000);
  // An expired schedule is not silently replaced by a made-up future meeting.
  await owner(); await db.query("update public.meeting_rooms set meeting_time=now()-interval '1 hour' where code=$1", [code]);
  await actor(b); await share(3.15, 101.65);
  check((await state()).room.planning_started, false);
  console.log(`Auto-planning SQL checks passed: ${checks}. Ephemeral PGlite; no cloud writes. Concurrent multi-connection locking is not simulated.`);
} catch (error) {
  console.error('Isolated auto-planning SQL test failed:', { completedChecks: checks, errorType: error.name, sqlstate: error.code });
  process.exitCode = 1;
} finally { await db.close(); }
