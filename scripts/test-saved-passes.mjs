import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], alias: { '@': `${process.cwd()}/src` }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'saved-pass-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/saved-pass-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/saved-pass-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}

let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const originals = Object.fromEntries(['localStorage', 'window', 'document', 'HTMLElement', 'fetch'].map(key => [key, globalThis[key]]));
const originalNow = Date.now;
const stored = new Map();
const timers = new Map();
let timerId = 0;
let now = Date.parse('2026-10-16T13:00:00+08:00');
let networkCalls = 0;
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
globalThis.window = { setInterval: callback => { timers.set(++timerId, callback); return timerId; }, clearInterval: id => timers.delete(id) };
globalThis.document = { activeElement: null, body: {} };
globalThis.HTMLElement = class {};
globalThis.fetch = async () => { networkCalls++; throw new Error('Room/routing services unavailable'); };
Date.now = () => now;
globalThis.__savedPassFixture = { memberId: 'device-owner', downloads: [] };

const makePass = (code, arrival, name) => {
  const leaveTime = new Date(Date.parse(arrival) - 600_000).toISOString();
  const from = { name: 'Saved starting point', stopId: null, lat: 3.05, lon: 101.59 };
  const to = { name, stopId: null, lat: 3.051, lon: 101.593 };
  return {
    schemaVersion: 1, kind: 'group-outing', evidenceMode: 'route-only', id: `saved-${code}`, roomCode: code,
    memberId: 'device-owner', planVersion: 2, checkedAt: '2026-10-15T12:00:00+08:00', routeTargetTime: arrival,
    selectedJourneyId: 'saved-walk', meeting: { version: 2, arrivalTime: arrival, venue: { id: name, type: 'cafe', kindLabel: 'Café', ...to } },
    leaveTime, estimatedArrivalTime: arrival, arrivalMarginSeconds: 0, status: 'Not checked',
    legs: [{ id: 'saved-leg', mode: 'WALK', transitLeg: false, routeId: null, routeShortName: null, routeLongName: null,
      routeColor: null, startTimeMs: Date.parse(leaveTime), endTimeMs: Date.parse(arrival), durationSeconds: 600,
      distanceMeters: 700, from, to, geometry: [from, to],
      steps: [{ relativeDirection: 'CONTINUE', streetName: 'Saved street', bogusName: false, distanceMeters: 700, lat: 3.05, lon: 101.59 }],
      estimatedStartTime: leaveTime, estimatedEndTime: arrival, cumulativeDelaySeconds: 0, delay: null }],
    connections: [], walking: { totalSeconds: 600, totalDistanceMeters: 700, directions: [] },
    weather: [{ status: 'not-checked', reason: 'not-requested', label: 'Weather unknown' }],
    closingMargin: { status: 'not-checked', reason: 'not-requested', label: 'Hours unknown' },
    weakPoint: { kind: 'unchecked-delay', label: 'No live evidence', marginSeconds: null },
  };
};

let page;
try {
  const storage = await load('src/features/outing-pass/passStorage.ts');
  const upcoming = makePass('ABCDEFGH', '2026-10-16T14:00:00+08:00', 'Saved Cafe');
  const historical = makePass('DEMN2345', '2026-10-14T14:00:00+08:00', 'Past Cafe');
  storage.savePersonalPass(upcoming);
  storage.savePersonalPass(historical);
  check(storage.listStoredPasses('device-owner', {}, now).map(pass => pass.id), [upcoming.id, historical.id]);
  check(storage.listStoredPasses('device-owner', {}, Date.parse('2026-10-17')).length, 2);
  check(storage.listStoredPasses('other-member').length, 0);
  const before = JSON.stringify([...stored]);

  const { MyPassesPage } = await load('src/features/outing-pass/components/MyPassesPage.tsx', {
    '@/features/meeting-point/supabaseClient': 'export const supabase = {auth:{getSession:async()=>({data:{session:{user:{id:globalThis.__savedPassFixture.memberId}}}})}};',
    './PrivateJourneyMap': 'export const PrivateJourneyMap = ({pass}) => <div data-saved-map={pass.id}/>;',
    '../passExport': 'export const downloadPassImage = async pass => { globalThis.__savedPassFixture.downloads.push(pass); };',
    'react-dom': 'export const createPortal = children => children;',
  });
  let meetingOpened = 0;
  const mount = () => create(React.createElement(MyPassesPage, { onOpenRoom: () => { meetingOpened++; } }));
  const text = () => JSON.stringify(page.toJSON());
  const button = label => page.root.findAllByType('button').find(node => node.children.some(child => typeof child === 'string' && child.includes(label)));
  await act(async () => { page = mount(); });
  check(page.root.findAllByType('article').length, 2);
  check(text().includes('Historical journey'), true);
  check(text().includes('Open meeting and refresh'), false);
  await act(async () => button('View journey').props.onClick());
  check(page.root.findByProps({ role: 'dialog' }).props['aria-modal'], 'true');
  check(text().includes('Your travel pass'), true);
  check(text().includes('Saved starting point'), true);
  check(text().includes('Saved street'), true);
  check(page.root.findByProps({ 'data-saved-map': upcoming.id }).type, 'div');
  check(text().includes('Route not updated live'), true);
  check(text().includes('Refresh route'), false);
  check(page.root.findAllByProps({ 'aria-label': 'Back to meeting' }).length, 0);
  check(meetingOpened, 0);
  check(networkCalls, 0);
  await act(async () => button('Download pass').props.onClick());
  check(globalThis.__savedPassFixture.downloads, [upcoming]);
  check(JSON.stringify([...stored]), before);

  // A pass becomes history while open without a route request or deletion.
  now = Date.parse(upcoming.meeting.arrivalTime);
  await act(async () => { for (const tick of timers.values()) tick(); });
  check(text().includes('Past meeting · saved schedule'), true);
  check(text().includes('Planned departure'), true);
  check(text().includes('Leave in'), false);
  check(text().includes('Suggested departure passed'), false);
  await act(async () => button('Download pass').props.onClick());
  check(globalThis.__savedPassFixture.downloads.length, 2);
  await act(async () => page.root.findByProps({ 'aria-label': 'Back to My Passes' }).props.onClick());
  check(page.root.findAllByProps({ role: 'dialog' }).length, 0);
  check(page.root.findAllByType('article').length, 2);
  check(meetingOpened, 0);
  check(networkCalls, 0);
  await act(async () => page.unmount());
  check(timers.size, 0);

  // Reopening after the meeting ended still loads the original route, not its room.
  await act(async () => { page = mount(); });
  await act(async () => button('View journey').props.onClick());
  check(text().includes('Historical journey'), true);
  check(text().includes('Past meeting · saved schedule'), true);
  await act(async () => page.unmount());

  // A changed device identity must never expose another member's local routes.
  globalThis.__savedPassFixture.memberId = 'other-member';
  await act(async () => { page = mount(); });
  check(page.root.findAllByType('article').length, 0);
  check(text().includes('No saved passes yet'), true);
  await act(async () => button('Go to Meet').props.onClick());
  check(meetingOpened, 1);
  check(networkCalls, 0);
  check(JSON.stringify([...stored]), before);
} finally {
  if (page) await act(async () => page.unmount());
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  Date.now = originalNow;
  delete globalThis.__savedPassFixture;
}
console.log(`Saved pass regression checks passed: ${checks}. Isolated local storage; no room or route requests.`);
