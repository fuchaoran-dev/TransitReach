import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
    define: { 'import.meta.env.VITE_RELIABILITY_API_URL': '""' }, plugins: [{ name: 'feedback-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/feedback-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/feedback-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const venue = { id: 'station-a', type: 'station', name: 'Pasar Seni', kindLabel: 'Rail station', lat: 3.142, lon: 101.695 };
const arrival = '2026-10-20T18:30:00+08:00';
const point = { at: { lat: 3.134, lon: 101.686 }, source: 'map', label: 'KL Sentral' };
const { meetingPreviewStart } = await load('src/features/meeting-point/meetingTime.ts');
check(meetingPreviewStart(arrival, 30, Date.parse('2026-10-20T09:59Z')), '2026-10-20T10:00:00.000Z');
assert.throws(() => meetingPreviewStart(arrival, 30, Date.parse('2026-10-20T10:00:01Z')), /30 minutes/); checks++;
assert.throws(() => meetingPreviewStart('bad', 30), /valid meeting/); checks++;

const { MyStartingPoint } = await load('src/features/meeting-point/components/MyStartingPoint.tsx', {
  '@/features/reachability': 'import React from "react"; export const LocationSearch = ({onSelect}) => <input onChange={() => onSelect({})} />;',
  '@/features/reachability/reachabilityService': 'export const hitName = () => "KL Sentral"; export const originFromHit = () => globalThis.__feedbackPoint;',
});
globalThis.__feedbackPoint = point;
let saved = 0; let draft = null; let gps; let geoCalls = 0;
const oldNavigator = globalThis.navigator;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition(success) { geoCalls++; gps = success; } } } });
const props = { me: null, draft: null, notice: null, onSelect: value => { draft = value; }, onShare: () => { saved++; }, onCancel: () => { draft = null; }, onWithdraw() {} };
let widget;
await act(async () => { widget = create(React.createElement(MyStartingPoint, props)); });
check(widget.root.findAllByProps({ type: 'checkbox' }).length, 0);
await act(async () => { widget.root.findByType('input').props.onChange(); });
check(draft.label, 'KL Sentral'); check(saved, 0);
await act(async () => { widget.update(React.createElement(MyStartingPoint, { ...props, draft })); });
await act(async () => { widget.root.findAllByType('button').find(button => button.children.includes('Share starting point')).props.onClick(); });
check(saved, 1);
check(geoCalls, 0);
await act(async () => { widget.root.findAllByType('button')[0].props.onClick(); });
check(geoCalls, 1);
await act(async () => { widget.root.findAllByType('button').find(button => button.children.includes('Cancel location request')).props.onClick(); });
await act(async () => { gps({ coords: { latitude: 3.3, longitude: 101.8 } }); });
check(draft, null); check(saved, 1);
await act(async () => { widget.unmount(); });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: oldNavigator });

const { SharedMeetingMap } = await load('src/features/meeting-point/components/SharedMeetingMap.tsx', {
  'react-leaflet': 'import React from "react"; export const CircleMarker = props => <div data-circle="true">{props.children}</div>; export const Tooltip = props => <label>{props.children}</label>; export const Polygon = () => null; export const useMap = () => ({});',
  'leaflet': 'export const latLngBounds = () => ({});', './dummy': '',
  '../mapFraming': 'export const panelPadding = () => ({});',
});
const map = renderToStaticMarkup(React.createElement(SharedMeetingMap, { members: [
  { id: 'a', displayName: 'Aina', at: point.at, isSelf: true }, { id: 'b', displayName: 'Ming', at: point.at, isSelf: false },
], areas: [], frameRequest: 0 }));
check((map.match(/data-circle/g) ?? []).length, 1); check(map.includes('Aina (you) · Ming'), true);

const from = { name: 'KL Sentral', stopId: null, lat: point.at.lat, lon: point.at.lon };
const to = { name: venue.name, stopId: null, lat: venue.lat, lon: venue.lon };
const end = Date.parse(arrival) - 60000;
const start = end - 10 * 60000;
const leg = { mode: 'WALK', transitLeg: false, routeId: null, routeShortName: null, routeLongName: null, routeColor: null,
  from, to, startTimeMs: start, endTimeMs: end, durationSeconds: 600, distanceMeters: 800, steps: [], geometry: [from, to] };
globalThis.__feedbackRoutes = [{ startTimeMs: start, endTimeMs: end, durationSeconds: 600, legs: [leg], transfers: 0 }];
const { generateTravelPass } = await load('src/features/outing-pass/travelPassService.ts', {
  '@/shared/services/transitRoutingClient': 'export const routeArriveByJourneys = async (...args) => { globalThis.__feedbackRouteArgs = args; return globalThis.__feedbackRoutes; };',
});
const oldNow = Date.now;
Date.now = () => Date.parse('2026-10-14T10:00:00Z');
const input = { roomCode: 'ABCDEFGH', memberId: 'own-fixture', plan: { version: 1, venue, arrivalTime: arrival }, origin: point.at, budgetMinutes: 30 };
const generated = await generateTravelPass(input);
check(generated.passes[0].evidenceMode, 'route-only');
check(globalThis.__feedbackRouteArgs[2], arrival);
check(generated.passes[0].weather[0].reason, 'not-requested');
check(generated.passes[0].leaveTime, new Date(start).toISOString());
check(JSON.stringify(generated.passes).includes('modelVersion'), false);
globalThis.__feedbackRouteArgs = null;
const zero = await generateTravelPass({ ...input, origin: { lat: venue.lat, lon: venue.lon } });
check(zero.passes[0].zeroTravel, true);
check(zero.passes[0].walking.totalSeconds, 0);
check(globalThis.__feedbackRouteArgs, null);
globalThis.__feedbackRoutes = [{ startTimeMs: start, endTimeMs: Date.parse(arrival) + 1, legs: [leg] }];
await assert.rejects(() => generateTravelPass(input), /No journey/); checks++;
globalThis.__feedbackRoutes = [{ startTimeMs: end - 31 * 60000, endTimeMs: end, legs: [leg] }];
await assert.rejects(() => generateTravelPass(input), /No journey/); checks++;
const aborted = new AbortController(); aborted.abort();
await assert.rejects(() => generateTravelPass(input, aborted.signal), { name: 'AbortError' }); checks++;
const { savePersonalPass, listStoredPasses } = await load('src/features/outing-pass/passStorage.ts');
const oldStorage = globalThis.localStorage;
const data = new Map(); globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
savePersonalPass(generated.passes[0]);
check(listStoredPasses('own-fixture', {}, Date.parse(arrival) - 1)[0].evidenceMode, 'route-only');
check(listStoredPasses('other-member', {}, Date.parse(arrival) - 1).length, 0);
globalThis.localStorage = oldStorage;
Date.now = oldNow;
for (const name of ['__feedbackPoint', '__feedbackRoutes', '__feedbackRouteArgs']) delete globalThis[name];
console.log(`Meeting feedback regression checks passed: ${checks}. Controlled fixtures, not live rooms.`);
