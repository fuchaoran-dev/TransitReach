import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
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
    alias: { '@': `${process.cwd()}/src` },
    define: { 'import.meta.env': '{}' },
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [{ name: 'meeting-polish-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/meeting-polish-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/meeting-polish-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}

let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

const map = {
  zoom: 13,
  fitted: false,
  getZoom() { return this.zoom; },
  on() {},
  off() {},
  getContainer() { return { closest() { return null; } }; },
  fitBounds() { this.fitted = true; },
};
globalThis.__meetingPolishMap = map;
const leafletStubs = {
  'react-leaflet': `import React from 'react';
    export const Marker = p => <button className={p.icon.className} data-icon={p.icon.html} title={p.title} onClick={p.eventHandlers?.click}>{p.children}</button>;
    export const Tooltip = p => <span>{p.children}</span>; export const useMap = () => globalThis.__meetingPolishMap;`,
  'leaflet': 'export const divIcon = value => value; export const latLngBounds = (...value) => value;',
  '@/shared/hooks': 'export const usePrefersReducedMotion = () => true;',
};
const { RankedPlaceMarkers } = await load('src/features/meeting-point/components/RankedPlaceMarkers.tsx', leafletStubs);
const cafe = { id: 'cafe-a', type: 'cafe', name: 'Bayu Cafe', kindLabel: 'Café', lat: 3.1000, lon: 101.6000 };
const nearby = { id: 'food-b', type: 'restaurant', name: 'Nearby Food', kindLabel: 'Restaurant', lat: 3.1005, lon: 101.6005 };
const places = [{ rank: 1, venue: cafe }, { rank: 2, venue: nearby }];
let markers = renderToStaticMarkup(React.createElement(RankedPlaceMarkers, { places, selectedId: null, onSelect() {} }));
check(markers.includes('+2'), true);
let markerTree;
await act(async () => { markerTree = create(React.createElement(RankedPlaceMarkers, { places, selectedId: null, onSelect() {} })); });
await act(async () => { markerTree.root.findByType('button').props.onClick(); });
check(map.fitted, true);
await act(async () => { markerTree.unmount(); });
map.zoom = 16;
markers = renderToStaticMarkup(React.createElement(RankedPlaceMarkers, { places, selectedId: cafe.id, onSelect() {} }));
check(markers.includes('Bayu Cafe'), true);
check(markers.includes('&lt;svg'), true);
check(markers.includes('opacity:0.28'), true);

const { paddingForPanelRects } = await load('src/features/meeting-point/mapFraming.ts');
const pageRect = { left: 0, right: 1024, top: 0, bottom: 768, width: 1024, height: 768 };
let padding = paddingForPanelRects(pageRect, [{ left: 658, right: 1008, top: 16, bottom: 752, width: 350, height: 736 }]);
check(padding.paddingTopLeft[0], 24);
check(padding.paddingBottomRight[0], 382);
padding = paddingForPanelRects({ left: 0, right: 390, top: 0, bottom: 780, width: 390, height: 780 }, [{ left: 0, right: 390, top: 430, bottom: 780, width: 390, height: 350 }]);
check(padding.paddingBottomRight[1], 366);
padding = paddingForPanelRects({ left: 0, right: 390, top: 0, bottom: 780, width: 390, height: 780 }, [{ left: 0, right: 390, top: 220, bottom: 780, width: 390, height: 560 }, { left: 0, right: 390, top: 430, bottom: 780, width: 390, height: 350 }]);
check(padding.paddingBottomRight[1], 576);

const plannerStubs = {
  '@/features/reachability': `import React from 'react'; export const BaseMap = p => <div data-base-map="true" data-city-regions={p.cityRegions.length} data-shared={String(p.sharedArea)}>{p.children}</div>; export const TimeBudgetSelector = () => <div/>;`,
  '@/features/reachability/reachabilityService': 'export const isInStudyArea = () => true;',
  '@/features/outing-pass/components/passPresentation': 'export const malaysiaInputTime = () => "2099-10-15T14:28";',
  '@/features/outing-pass/components/MeetingTravelPass': 'export const MeetingTravelPass = () => null;',
  './meetingTime': 'export const meetingPreviewStart = () => new Date();',
  './meetingMapWaypoints': 'export const SHARED_MEMBER_COLOURS=["#2dd4bf","#60a5fa"]; export const meetingMapWaypoints=()=>[];',
  './components/RankedPlaceMarkers': 'export const RankedPlaceMarkers=()=>null; export const FocusOnPlace=()=>null;',
  './components/MyStartingPoint': 'export const MyStartingPoint=()=>null;',
  './components/RoomLobby': 'export const RoomLobby=()=>null;',
  './components/ShareLink': 'export const ShareLink=()=>null;',
  './components/SharedMeetingMap': 'export const SharedMeetingMap=()=>null;',
  './components/SharedParticipantAreasLayer': 'export const SharedParticipantAreasLayer=()=>null;',
  './components/OverlapLayer': 'export const OverlapLayer=()=>null;',
  './components/MeetingRadarLayer': 'export const MeetingRadarLayer=()=>null;',
  './overlapService': 'export const intersectAreas=()=>[[[[101.6,3.1],[101.7,3.1],[101.7,3.2],[101.6,3.1]]]];',
  './hooks/useMeetingRoom': 'export const useMeetingRoom=()=>({});',
  './hooks/useServerCommonGround': 'export const useServerCommonGround=()=>({state:{status:"idle"},retry(){}});',
  './venueService': 'export const VENUE_TYPES=[{id:"cafe",label:"Cafés"}];',
};
const { MeetingPlanner } = await load('src/features/meeting-point/MeetingPointPage.tsx', plannerStubs);
const arrival = '2099-10-15T06:28:00.000Z';
const member = { id: 'member-a', userId: 'user-a', displayName: 'Aina', nickname: 'Aina', isSelf: true, at: { lat: 3.1, lon: 101.6 }, source: 'map', label: 'Start', colourSlot: 0, planningStatus: 'Ready', arrivalStatus: 'Not checked', checkedPlanVersion: null };
const meeting = {
  view: { status: 'ready', room: { code: 'ABCDEFGH', timeBudget: 30, meetingTime: arrival, votingArrivalTime: arrival, planningRevision: 1, planningStarted: true, isHost: true, confirmedPlan: null, voteStatus: 'waiting' }, me: member, members: [member, { ...member, id: 'member-b', userId: 'user-b', displayName: 'Ming', isSelf: false, colourSlot: 1 }], selections: [], votes: [] },
  busy: false, error: null, setMyPoint: async () => true, changeBudget: async () => {}, changeMeetingTime: async () => {}, leave: async () => {}, reopenPlanning: async () => {}, proposeVenue: async () => {}, vote: async () => {},
};
const result = { status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, roomRevision: 1, departureTime: arrival, arrivalTime: arrival, areaMethod: 'budget-window-preview', participantAreas: [{ memberId: 'member-a', regions: [{}] }, { memberId: 'member-b', regions: [{}] }], proposals: [{ rank: 1, venue: cafe, longestMinutes: 12, gapMinutes: 4, participantTrips: [{ memberId: 'member-b', minutes: 12 }, { memberId: 'member-a', minutes: 8 }] }] };
const common = { state: { status: 'ready', result }, retry() {} };
const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://example.test', pathname: '/' } };
let planner;
await act(async () => { planner = create(React.createElement(MeetingPlanner, { meeting, commonGround: common })); });
check(planner.root.findAllByType('aside')[0].props.hidden, false);
let baseMap = planner.root.find(node => node.props['data-base-map'] === 'true');
check(baseMap.props['data-city-regions'], 1);
const areaToggle = planner.root.findAllByType('button').find(button => button.props['aria-pressed'] === true && button.children.includes('Shared reachability'));
assert.ok(areaToggle); checks++;
await act(async () => { areaToggle.props.onClick(); });
baseMap = planner.root.find(node => node.props['data-base-map'] === 'true');
check(baseMap.props['data-city-regions'], 0);
check(baseMap.props['data-shared'], 'false');
const tripRows = planner.root.findByProps({ 'aria-label': 'Verified travel time for each member' }).findAllByType('li');
check(tripRows[0].findAllByType('span')[0].children.join(''), 'Aina');
check(tripRows[0].findAllByType('span').at(-1).children.join(''), '8 min');
check(tripRows[1].findAllByType('span')[0].children.join(''), 'Ming');
check(tripRows[1].findAllByType('span').at(-1).children.join(''), '12 min');
await act(async () => { planner.unmount(); });

let mediaChange;
globalThis.window = { location: { origin: 'https://example.test', pathname: '/' }, matchMedia: () => ({ matches: true, addEventListener(_type, listener) { mediaChange = listener; }, removeEventListener() {} }) };
await act(async () => { planner = create(React.createElement(MeetingPlanner, { meeting, commonGround: common })); });
check(planner.root.findAllByType('aside')[0].props.hidden, true);
await act(async () => { mediaChange({ matches: false }); });
check(planner.root.findAllByType('aside')[0].props.hidden, false);
await act(async () => { planner.unmount(); });

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => {} } } });
globalThis.window = { location: { origin: 'https://example.test', pathname: '/meet', href: 'https://example.test/meet' } };
const { ShareLink } = await load('src/features/meeting-point/components/ShareLink.tsx', {
  qrcode: 'export default {toDataURL: async value => `data:image/png;base64,${encodeURIComponent(value)}`};',
});
let share;
await act(async () => { share = create(React.createElement(ShareLink, { code: 'ABCDEFGH' })); });
const qrButton = share.root.findByProps({ 'aria-label': 'Show room QR code' });
await act(async () => { qrButton.props.onClick(); });
check(share.root.findByType('img').props.src.includes('ABCDEFGH'), true);
await act(async () => { share.update(React.createElement(ShareLink, { code: 'DEMN2345' })); });
check(share.root.findByType('img').props.src.includes('DEMN2345'), true);
check(share.root.findByType('img').props.src.includes('ABCDEFGH'), false);
await act(async () => { share.unmount(); });

globalThis.window = originalWindow;
if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
else delete globalThis.navigator;
delete globalThis.__meetingPolishMap;
console.log(`Meeting polish checks passed: ${checks}. Synthetic render fixtures, no network or room writes.`);
