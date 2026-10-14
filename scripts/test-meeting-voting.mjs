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
    define: { 'import.meta.env.VITE_RELIABILITY_API_URL': '""' }, plugins: [{ name: 'meeting-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/voting-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/voting-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const service = await load('src/features/meeting-point/roomService.ts');
const calls = [];
const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: null, error: null }; } };
const venue = { id: 'station-1', type: 'station', name: 'Pasar Seni', kindLabel: 'Rail station', lat: 3.142, lon: 101.695 };
await service.setMyPoint(client, 'ABCDEFGH', 'self', { at: { lat: 3.1, lon: 101.6 }, source: 'device', label: 'Current location' });
assert.equal(calls[0][0], 'share_meeting_origin'); checks++;
assert.equal(calls[0][1].p_source, 'device'); checks++;
assert.equal('p_user_id' in calls[0][1], false); checks++;
await service.setMyPoint(client, 'ABCDEFGH', 'self', null);
assert.equal(calls[1][1].p_lat, null); checks++;
await service.castMeetingVote(client, 'ABCDEFGH', venue, '2026-10-20T09:00:00+08:00', 4);
assert.equal(calls[2][0], 'cast_meeting_vote'); checks++;
assert.equal(calls[2][1].p_revision, 4); checks++;
await service.proposeMeetingVenue(client, 'ABCDEFGH', venue, 4);
assert.equal(calls[3][0], 'propose_meeting_venue'); checks++;
await service.setRoomBudget(client, 'ABCDEFGH', 45);
assert.deepEqual(calls[4], ['set_meeting_budget', { p_code: 'ABCDEFGH', p_budget: 45 }]); checks++;

const location = await load('src/features/meeting-point/components/MyStartingPoint.tsx', {
  '@/features/reachability': 'export const LocationSearch = () => null;',
  '@/features/reachability/reachabilityService': 'export const formatCoord = () => ""; export const hitName = () => ""; export const originFromHit = () => null;',
});
const oldNavigator = globalThis.navigator;
let positionCallback;
let geoCalls = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition(success) { geoCalls++; positionCallback = success; } } } });
const saved = [];
let widget;
const props = { me: null, notice: null, sharingAllowed: false, onSharingChange() {}, onSearchSelect: point => saved.push(point), onClear() {} };
await act(async () => { widget = create(React.createElement(location.MyStartingPoint, props)); });
assert.equal(geoCalls, 0); checks++;
assert.equal(widget.root.findAllByType('button')[0].props.disabled, true); checks++;
await act(async () => { widget.update(React.createElement(location.MyStartingPoint, { ...props, sharingAllowed: true })); });
await act(async () => { widget.root.findAllByType('button')[0].props.onClick(); });
assert.equal(geoCalls, 1); checks++;
await act(async () => { positionCallback({ coords: { latitude: 3.1, longitude: 101.6 } }); });
assert.deepEqual(saved[0], { at: { lat: 3.1, lon: 101.6 }, source: 'device', label: 'Current location' }); checks++;
await act(async () => { widget.unmount(); });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: oldNavigator });

const ring = [[101.68, 3.13], [101.7, 3.13], [101.7, 3.15], [101.68, 3.15], [101.68, 3.13]];
globalThis.__meetingFixture = {
  view: { status: 'ready', room: { code: 'ABCDEFGH', timeBudget: 30, planningRevision: 4, planningStarted: true, isHost: true, departureTime: '2026-10-20T08:00:00+08:00', votingArrivalTime: '2026-10-20T09:00:00+08:00', voteStatus: 'waiting', confirmedPlan: null },
    me: { id: 'a', userId: 'own', nickname: 'Aina', at: { lat: 3.13, lon: 101.68 }, source: 'map' },
    members: [{ id: 'a', displayName: 'Aina', planningStatus: 'Ready', at: { lat: 3.13, lon: 101.68 }, isSelf: true }, { id: 'b', displayName: 'Jia Wei', planningStatus: 'Not ready', at: null, isSelf: false }],
    votes: [], selections: [{ memberId: 'b', displayName: 'Jia Wei', venue }] },
  busy: false, error: null, setMyPoint: async () => {}, changeBudget: async () => {}, leave: async () => {}, startPlanning: async () => {}, reopenPlanning: async () => {}, proposeVenue: async () => {}, vote: async () => {},
};
globalThis.__meetingGround = { state: { status: 'ready', result: { roomRevision: 4, status: 'ready', participantAreas: [{ regions: [{ outer: ring, holes: [] }] }, { regions: [{ outer: ring, holes: [] }] }], proposals: [{ rank: 1, venue, longestMinutes: 20, gapMinutes: 5 }] } }, retry() {} };
const page = await load('src/features/meeting-point/MeetingPointPage.tsx', {
  './hooks/useMeetingRoom': 'export const useMeetingRoom = () => globalThis.__meetingFixture;',
  './hooks/useServerCommonGround': 'export const useServerCommonGround = () => globalThis.__meetingGround;',
  '@/features/reachability': 'import React from "react"; export const BaseMap = props => <div className="meeting-fixture-map">{props.children}</div>; export const TimeBudgetSelector = () => <div>15 · 30 · 45 · 60 min</div>; export const LocationSearch = () => <input aria-label="Search starting point" placeholder="Search station, stop or place"/>;',
  '@/features/reachability/reachabilityService': 'export const isInStudyArea = () => true; export const formatCoord = () => "Saved starting point"; export const hitName = () => ""; export const originFromHit = () => null;',
  './components/RankedPlaceMarkers': 'export const FocusOnPlace = () => null; export const RankedPlaceMarkers = () => null;',
  './components/SharedMeetingMap': 'export const SharedMeetingMap = () => null;',
  './components/OverlapLayer': 'export const OverlapLayer = () => null;',
  './components/ShareLink': 'import React from "react"; export const ShareLink = () => <p>Room ABCDEFGH · Invite your group</p>;',
  '@/features/outing-pass/components/passPresentation': 'export const malaysiaInputTime = iso => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0,16);',
  './venueService': 'export const VENUE_TYPES = [{id:"station",label:"Stations"},{id:"cafe",label:"Cafés"},{id:"restaurant",label:"Restaurants"},{id:"mall",label:"Malls"}];',
});
const markup = () => renderToStaticMarkup(React.createElement(page.MeetingPointPage));
assert.ok(markup().includes('✓ Ready')); checks++;
assert.ok(markup().includes('Not ready')); checks++;
assert.ok(markup().includes('Proposed by Jia Wei')); checks++;
assert.equal(markup().includes('Confirm for everyone'), false); checks++;
assert.equal(markup().includes('Check needed'), false); checks++;
globalThis.__meetingFixture.view.room.voteStatus = 'tie';
assert.ok(markup().includes('The vote is tied')); checks++;
globalThis.__meetingFixture.view.votes = [{ memberId: 'b', displayName: 'Jia Wei', venue, arrivalTime: '2026-10-20T09:00:00+08:00' }];
assert.ok(markup().includes('1/2 voted')); checks++;
assert.ok(markup().includes('Voted: Jia Wei')); checks++;
globalThis.__meetingGround.state.result.roomRevision = 3;
assert.equal(markup().includes('longest 20 min'), false); checks++;
globalThis.__meetingGround.state.result.roomRevision = 4;
if (process.argv.includes('--markup')) {
  // Layout QA uses an internally consistent tied round, not the defensive state assertions above.
  const secondVenue = { ...venue, id: 'cafe-2', type: 'cafe', name: 'Example café', kindLabel: 'Café' };
  globalThis.__meetingFixture.view.members[1] = { ...globalThis.__meetingFixture.view.members[1], planningStatus: 'Ready', at: { lat: 3.15, lon: 101.7 }, label: 'Selected station' };
  globalThis.__meetingFixture.view.votes.push({ memberId: 'a', displayName: 'Aina', venue: secondVenue, arrivalTime: '2026-10-20T09:00:00+08:00' });
  globalThis.__meetingGround.state.result.proposals.push({ rank: 2, venue: secondVenue, longestMinutes: 23, gapMinutes: 4 });
  console.log(markup());
}
else console.log(`Meeting voting regression checks passed: ${checks}.`);
delete globalThis.__meetingFixture;
delete globalThis.__meetingGround;
