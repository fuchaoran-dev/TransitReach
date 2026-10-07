import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');

async function load(entry, stubs = {}) {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_RELIABILITY_API_URL': '""' },
    plugins: [{
      name: 'meeting-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
      },
    }],
  });
  const module = new Module(`${process.cwd()}/scripts/meeting-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/meeting-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

let checks = 0;
const roomService = await load('src/features/meeting-point/roomService.ts');
const rpcCalls = [];
const snapshot = await roomService.loadRoom({
  rpc: async (name, args) => {
    rpcCalls.push([name, args]);
    return {
      data: {
        room: {
          code: 'ABCDEFGH', time_budget: 30, expires_at: '2026-10-08T10:00:00Z',
          updated_at: '2026-10-07T10:00:00Z', confirmed_venue: null,
          planning_revision: 4,
          confirmed_arrival_time: null, plan_version: 0, proposed_arrival_time: null,
        },
        self: {
          id: 'self-row', user_id: 'private-user', nickname: 'Aina', lat: 3.1, lon: 101.6,
          source: 'map', label: null, colour_slot: 0, arrival_status: 'not_checked', checked_plan_version: null,
        },
        members: [
          { id: 'self-row', display_name: 'Aina', arrival_status: 'Not checked', is_self: true },
          { id: 'other-row', display_name: 'Jia Wei', arrival_status: 'Ready', is_self: false },
        ],
      },
      error: null,
    };
  },
  from: () => { throw new Error('loadRoom must not query participant rows directly'); },
}, 'ABCDEFGH');
assert.deepEqual(rpcCalls, [['get_meeting_room_state', { p_code: 'ABCDEFGH' }]]); checks++;
assert.deepEqual(snapshot.me.at, { lat: 3.1, lon: 101.6 }); checks++;
assert.deepEqual(snapshot.members[1], { id: 'other-row', displayName: 'Jia Wei', arrivalStatus: 'Ready', isSelf: false }); checks++;
assert.equal('userId' in snapshot.members[1] || 'at' in snapshot.members[1] || 'lat' in snapshot.members[1], false); checks++;

const invitationCalls = [];
const invitation = await roomService.loadMeetingInvitation({
  rpc: async (name, args) => {
    invitationCalls.push([name, args]);
    return {
      data: {
        code: 'ABCDEFGH',
        confirmed_venue: { id: 'station-1', type: 'station', name: 'Pasar Seni', kindLabel: 'Rail station', lat: 3.1, lon: 101.7 },
        confirmed_arrival_time: '2026-10-10T10:30:00Z',
        plan_version: 2,
      },
      error: null,
    };
  },
}, 'ABCDEFGH');
assert.deepEqual(invitationCalls, [['get_meeting_invitation', { p_code: 'ABCDEFGH' }]]); checks++;
assert.deepEqual(Object.keys(invitation).sort(), ['code', 'confirmedPlan']); checks++;
assert.equal(JSON.stringify(invitation).includes('member'), false); checks++;
const { RoomLobby } = await load('src/features/meeting-point/components/RoomLobby.tsx');
const invitationMarkup = renderToStaticMarkup(React.createElement(RoomLobby, {
  invitedCode: 'ABCDEFGH',
  invitation,
  busy: false,
  error: null,
  onCreate() {},
  onJoin() {},
}));
assert.ok(invitationMarkup.includes('Meet at Pasar Seni')); checks++;
assert.ok(invitationMarkup.includes('Join room')); checks++;
assert.equal(invitationMarkup.includes('Jia Wei'), false); checks++;

const { ShareLink } = await load('src/features/meeting-point/components/ShareLink.tsx', {
  '../roomLink': 'export const shareLinkFor = code => `https://example.com/?meet=${code}`;',
});
const shareMarkup = renderToStaticMarkup(React.createElement(ShareLink, { code: 'ABCDEFGH' }));
assert.ok(shareMarkup.includes('Starting points stay private')); checks++;
assert.equal(shareMarkup.includes("everyone&#x27;s starting points"), false); checks++;
assert.ok(shareMarkup.includes('after the agreed arrival')); checks++;

const { MyStartingPoint } = await load('src/features/meeting-point/components/MyStartingPoint.tsx', {
  '@/features/reachability': 'export const LocationSearch = () => null;',
  '@/features/reachability/reachabilityService': 'export const formatCoord = () => ""; export const hitName = () => ""; export const originFromHit = () => null;',
});
const startingMarkup = renderToStaticMarkup(React.createElement(MyStartingPoint, {
  me: null, notice: null, onSearchSelect() {}, onClear() {},
}));
assert.ok(startingMarkup.includes('Only you can view your starting point')); checks++;
assert.equal(startingMarkup.includes('Everyone in the room sees'), false); checks++;

const registrations = [];
const oldWindow = globalThis.window;
globalThis.window = { setInterval: () => 71, clearInterval: () => {} };
try {
  const channel = {
    on(kind, filter) { registrations.push([kind, filter]); return this; },
    subscribe() { return this; },
  };
  const stop = await roomService.subscribeToRoom({
    auth: { getSession: async () => ({ data: { session: { access_token: 'private-token' } } }) },
    realtime: { setAuth: async () => {} },
    channel: () => channel,
    removeChannel: async () => {},
  }, 'ABCDEFGH', () => {});
  assert.equal(registrations.some(([, filter]) => filter.table === 'meeting_participants'), false); checks++;
  assert.equal(registrations.some(([, filter]) => filter.table === 'meeting_rooms'), true); checks++;
  stop();
} finally {
  globalThis.window = oldWindow;
}

const commonGround = await load('src/features/meeting-point/commonGroundService.ts');
const savedFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, options) => {
  request = { url, options };
  return { ok: true, json: async () => ({ status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, proposals: [] }) };
};
try {
  await commonGround.fetchCommonGround(
    { auth: { getSession: async () => ({ data: { session: { access_token: 'secret' } } }) } },
    'ABCDEFGH',
    30,
    ['station'],
    new AbortController().signal,
  );
  assert.equal(request.options.headers.Authorization, 'Bearer secret'); checks++;
  assert.deepEqual(JSON.parse(request.options.body), { timeBudget: 30, venueTypes: ['station'] }); checks++;
  assert.equal(/lat|lon|origin|participant/i.test(request.options.body), false); checks++;
} finally {
  globalThis.fetch = savedFetch;
}

globalThis.__meetingAudit = { requests: [] };
globalThis.__meetingAudit.fetch = () => {
  const task = deferred();
  globalThis.__meetingAudit.requests.push(task);
  return task.promise;
};
const hooks = await load('src/features/meeting-point/hooks/useServerCommonGround.ts', {
  '../commonGroundService': 'export const fetchCommonGround = (...args) => globalThis.__meetingAudit.fetch(...args);',
  '../supabaseClient': 'export const supabase = {};',
});
let model;
let view;
function Probe(props) {
  model = hooks.useServerCommonGround(props.code, props.budget, props.types, props.revision);
  return null;
}
await act(async () => { view = create(React.createElement(Probe, { code: 'ABCDEFGH', budget: 30, types: new Set(['station']), revision: 'one' })); });
await act(async () => { view.update(React.createElement(Probe, { code: 'ABCDEFGH', budget: 30, types: new Set(['station']), revision: 'two' })); });
await act(async () => globalThis.__meetingAudit.requests[0].resolve({ status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, proposals: [{ rank: 1 }] }));
assert.equal(model.state.status, 'loading'); checks++;
await act(async () => globalThis.__meetingAudit.requests[1].resolve({ status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, proposals: [{ rank: 2 }] }));
assert.equal(model.state.result.proposals[0].rank, 2); checks++;
await act(async () => view.unmount());
delete globalThis.__meetingAudit;

console.log(`Meeting privacy and lifecycle regression checks passed: ${checks}.`);
