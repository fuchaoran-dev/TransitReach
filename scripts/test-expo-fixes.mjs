import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], tsconfig: 'tsconfig.app.json', define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'expo-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/expo-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/expo-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); checks++; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const json = value => new Response(JSON.stringify(value));
const result = { status: 'ready', areaMethod: 'budget-window-preview', roomRevision: 7, budgetMinutes: 60,
  participantCount: 5, missingStartingPoints: 0,
  arrivalTime: '2026-10-20T18:30:00+08:00', participantAreas: Array.from({ length: 5 }, (_, i) => ({ memberId: `member-${i}`, regions: [] })), proposals: [] };
const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-only' } } }) } };
const { fetchCommonGround } = await load('src/features/meeting-point/commonGroundService.ts');
async function clockTest(run) {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map(); let now = 0; let next = 0;
  globalThis.setTimeout = (callback, delay = 0) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = async milliseconds => {
    const target = now + milliseconds;
    for (;;) {
      const item = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!item) break;
      now = item[1].at; timers.delete(item[0]); item[1].callback(); await tick();
    }
    now = target; await tick();
  };
  try { await run(advance); check(timers.size, 0); }
  finally { Object.assign(globalThis, original); }
}
await clockTest(async advance => {
  let calls = 0; const previews = []; const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options }); calls++;
    if (calls === 1) return new Response(null, { status: 504 });
    return json(calls === 2 ? { status: 'computing', result: { ...result, status: 'finding_places' } } : { status: 'ready', result });
  };
  const task = fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7, value => previews.push(value));
  await tick(); await advance(5_000); check(previews.length, 1); await advance(2_000);
  check(await task, result); check(calls, 3);
  check(requests.every(r => r.url.endsWith('/common-ground-job')), true);
  check(JSON.parse(requests[0].options.body), { timeBudget: 60, venueTypes: ['station'], roomRevision: 7 });
});
for (const status of [401, 403, 404, 409]) await clockTest(async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status }); };
  await assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7)); checks++;
  check(calls, 1);
});
await clockTest(async advance => {
  let calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  const rejected = assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7), /temporarily unavailable/);
  await tick(); await advance(15_000); await rejected; checks++; check(calls, 3);
});
await clockTest(async advance => {
  let calls = 0; const controller = new AbortController();
  globalThis.fetch = async () => { calls++; return json({ status: 'computing' }); };
  const rejected = assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], controller.signal, 7), { name: 'AbortError' });
  await tick(); controller.abort(); await rejected; checks++; await advance(20_000); check(calls, 1);
});
await clockTest(async advance => {
  globalThis.fetch = async () => json({ status: 'computing' });
  const rejected = assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7), /took too long/);
  await tick(); await advance(150_000); await rejected; checks++;
});
await clockTest(async advance => {
  globalThis.fetch = () => { throw new Error('No request should start before auth resolves'); };
  const stalled = { auth: { getSession: () => new Promise(() => {}) } };
  const rejected = assert.rejects(fetchCommonGround(stalled, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7), /Could not connect/);
  await tick(); await advance(51_000); await rejected; checks++;
});
await clockTest(async advance => {
  const previews = []; globalThis.fetch = async () => json({ status: 'failed', reason: 'routing_unavailable', result: { ...result, status: 'finding_places' } });
  const rejected = assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7, r => previews.push(r)), /route checks timed out/);
  await tick(); await advance(15_000); await rejected; checks++;
  check(previews.length, 3); check(previews.every(p => p.proposals.length === 0), true);
});
await clockTest(async () => {
  globalThis.fetch = async () => json({ status: 'ready', result: { ...result, roomRevision: 6 } });
  await assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7), /room changed/); checks++;
});
await clockTest(async () => {
  globalThis.fetch = async () => json({ status: 'computing', result: { ...result, status: 'finding_places', participantAreas: result.participantAreas.slice(0, 4) } });
  await assert.rejects(fetchCommonGround(client, 'ABCDEFGH', 60, ['station'], new AbortController().signal, 7), /incomplete/); checks++;
});

const routing = await load('src/shared/services/transitRoutingClient.ts');
const oldFetch = globalThis.fetch;
const walk = { startTime: 1_700_000_000_000, endTime: 1_700_000_600_000, duration: 600, legs: [{ mode: 'WALK', startTime: 1_700_000_000_000, endTime: 1_700_000_600_000, duration: 600, from: { lat: 3.1, lon: 101.6, name: 'Start' }, to: { lat: 3.11, lon: 101.61, name: 'End' } }] };
try {
  for (const arriveBy of [false, true]) {
    globalThis.fetch = async url => new URL(url, 'https://fixture.invalid').searchParams.get('mode') === 'WALK' ? json({ plan: { itineraries: [walk] } }) : new Response(null, { status: 504 });
    const route = arriveBy ? routing.routeArriveByJourneys : routing.routeJourneys;
    await assert.rejects(route({ lat: 3.1, lon: 101.6 }, { lat: 3.11, lon: 101.61 }, '2026-10-20T18:30:00+08:00'), /Couldn't get transit times/); checks++;
  }
  globalThis.fetch = async () => json({ plan: { itineraries: [walk] } });
  check((await routing.routeJourneys(walk.legs[0].from, walk.legs[0].to, '2026-10-20T18:30:00+08:00')).length, 1);
  for (const id of [404, 409]) {
    globalThis.fetch = async url => new URL(url, 'https://fixture.invalid').searchParams.get('mode') === 'WALK' ? json({ plan: { itineraries: [walk] } }) : json({ error: { id, message: 'No eligible transit path' } });
    check((await routing.routeJourneys(walk.legs[0].from, walk.legs[0].to, '2026-10-20T18:30:00+08:00')).length, 1);
  }
  globalThis.fetch = async url => new URL(url, 'https://fixture.invalid').searchParams.get('mode') === 'WALK' ? json({ plan: { itineraries: [walk] } }) : json({});
  await assert.rejects(routing.routeJourneys(walk.legs[0].from, walk.legs[0].to, '2026-10-20T18:30:00+08:00'), /Couldn't get transit times/); checks++;
} finally { globalThis.fetch = oldFetch; }

const oldWindow = globalThis.window;
globalThis.window = { setInterval: () => 1, clearInterval() {} };
const state = { calls: 0, snapshot: { room: { planningStarted: true }, me: {}, members: [] } };
globalThis.__expoRoom = state;
const { useMeetingRoom } = await load('src/features/meeting-point/hooks/useMeetingRoom.ts', {
  '../supabaseClient': 'export const supabase = {};',
  '../roomLink': 'export const normaliseRoomCode = x => x; export const roomParam = () => "ABCDEFGH"; export const writeRoomCodeToUrl = () => {};',
  '../roomService': `export class RoomNotFoundError extends Error {} export class RoomFullError extends Error {}
    export const ensureSignedIn = async () => 'synthetic-member';
    export const loadRoom = async () => { const s=globalThis.__expoRoom; s.calls++; return s.calls===1 ? s.snapshot : new Promise(resolve=>{s.refresh=resolve;}); };
    export const subscribeToRoom = async () => () => {}; export const setMyPoint = async () => {};
    export const createRoom=async()=>{},confirmMeetingPlan=async()=>{},joinRoom=async()=>{},leaveRoom=async()=>{},loadMeetingInvitation=async()=>null,setMyArrivalStatus=async()=>{},setRoomBudget=async()=>{},proposeMeetingTime=async()=>{},startMeetingPlanning=async()=>{},reopenMeetingPlanning=async()=>{},proposeMeetingVenue=async()=>{},castMeetingVote=async()=>{},ensureMeetingPlanning=async()=>{},setMeetingTime=async()=>{};`,
});
let model; let tree;
function Probe() { model = useMeetingRoom(); return null; }
try {
  await act(async () => { tree = create(React.createElement(Probe)); });
  check(model.view.status, 'ready');
  let saved;
  await act(async () => { saved = await model.setMyPoint({ at: { lat: 3.1, lon: 101.6 }, source: 'map' }); });
  check(saved, true); check(model.busy, false); check(typeof state.refresh, 'function');
  await act(async () => { tree.unmount(); });
} finally { globalThis.window = oldWindow; delete globalThis.__expoRoom; }
const { RoomLobby } = await load('src/features/meeting-point/components/RoomLobby.tsx');
const markup = renderToStaticMarkup(React.createElement(RoomLobby, { invitedCode: 'ABCDEFGH', invitation: { confirmedPlan: { version: 1, arrivalTime: result.arrivalTime, venue: { name: 'Public venue', kindLabel: 'Café' } } }, busy: false, error: null }));
check(markup.includes('Join room'), false); check(markup.includes('reopen'), true);

const { intersectAreas, overlapContains } = await load('src/features/meeting-point/overlapService.ts');
const outer = [[101, 3], [102, 3], [102, 4], [101, 4], [101, 3]];
const hole = [[101.4, 3.4], [101.6, 3.4], [101.6, 3.6], [101.4, 3.6], [101.4, 3.4]];
const fiveAreas = Array.from({ length: 5 }, (_, i) => [{ outer, holes: i === 2 ? [hole] : [] }]);
const overlap = intersectAreas(fiveAreas, 0);
check(overlapContains(overlap)(3.2, 101.2), true);
check(overlapContains(overlap)(3.5, 101.5), false);
check(intersectAreas([...fiveAreas.slice(0, 4), [{ outer: outer.map(([x, y]) => [x + 4, y]), holes: [] }]], 0), []);

const { TripMapLayer } = await load('src/features/trip-planner/components/TripMapLayer.tsx', {
  'react-leaflet': 'import React from "react"; export const Marker = p => <span data-title={p.title} data-number={p.icon.number}>{p.children}</span>; export const Tooltip = p => <span>{p.children}</span>; export const useMap = () => ({});',
  'leaflet': 'export const divIcon = p => ({number:/>((?:\\d+)|End|\\?)<\\/div>/.exec(p.html)?.[1]}); export const latLngBounds = () => ({});',
  '@/features/interchange/components/JourneyMapLayer': 'export const BoardAlightMarkers = () => null; export const LegPath = () => null;',
});
const markerMarkup = renderToStaticMarkup(React.createElement(TripMapLayer, { origin: null, stops: [{ id: 'a', name: 'Pharmacy', lat: 3.1, lon: 101.6 }, { id: 'b', name: 'Pavilion', lat: 3.2, lon: 101.7 }], final: null, planPanelOpen: false }));
check(markerMarkup.includes('data-title="1. Pharmacy" data-number="1"'), true);
check(markerMarkup.includes('data-title="2. Pavilion" data-number="2"'), true);
console.log(`Expo desktop regression checks passed: ${checks}. Controlled data/timers; no cloud room writes.`);
