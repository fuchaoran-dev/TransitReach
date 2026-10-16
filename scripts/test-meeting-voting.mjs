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
    define: { 'import.meta.env.VITE_RELIABILITY_API_URL': '""' }, loader: { '.css': 'empty' }, plugins: [{ name: 'meeting-fixtures', setup(builder) {
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
const props = { me: null, draft: null, notice: null, onSelect: point => saved.push(point), onShare() {}, onCancel() {}, onWithdraw() {} };
await act(async () => { widget = create(React.createElement(location.MyStartingPoint, props)); });
assert.equal(geoCalls, 0); checks++;
assert.equal(widget.root.findAllByType('button')[0].props.disabled, false); checks++;
await act(async () => { widget.root.findAllByType('button')[0].props.onClick(); });
assert.equal(geoCalls, 1); checks++;
await act(async () => { positionCallback({ coords: { latitude: 3.1, longitude: 101.6 } }); });
assert.deepEqual(saved[0], { at: { lat: 3.1, lon: 101.6 }, source: 'device', label: 'Current location' }); checks++;
await act(async () => { widget.unmount(); });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: oldNavigator });

const ring = [[101.68, 3.13], [101.7, 3.13], [101.7, 3.15], [101.68, 3.15], [101.68, 3.13]];
globalThis.__meetingFixture = {
  view: { status: 'ready', room: { code: 'ABCDEFGH', timeBudget: 30, meetingTime: '2026-10-20T09:00:00+08:00', planningRevision: 4, planningStarted: true, isHost: true, departureTime: '2026-10-20T08:00:00+08:00', votingArrivalTime: '2026-10-20T09:00:00+08:00', voteStatus: 'waiting', confirmedPlan: null },
    me: { id: 'a', userId: 'own', nickname: 'Aina', at: { lat: 3.13, lon: 101.68 }, source: 'map' },
    members: [{ id: 'a', displayName: 'Aina', planningStatus: 'Ready', at: { lat: 3.13, lon: 101.68 }, isSelf: true }, { id: 'b', displayName: 'Jia Wei', planningStatus: 'Not ready', at: null, isSelf: false }],
    votes: [], selections: [{ memberId: 'b', displayName: 'Jia Wei', venue }] },
  busy: false, error: null, setMyPoint: async () => {}, changeBudget: async () => {}, changeMeetingTime: async () => {}, leave: async () => {}, startPlanning: async () => {}, reopenPlanning: async () => {}, proposeVenue: async () => {}, vote: async () => {},
};
globalThis.__meetingGround = { state: { status: 'ready', result: { roomRevision: 4, status: 'ready', arrivalTime: '2026-10-20T09:00:00+08:00', areaMethod: 'budget-window-preview', participantAreas: [{ regions: [{ outer: ring, holes: [] }] }, { regions: [{ outer: ring, holes: [] }] }], proposals: [{ rank: 1, venue, longestMinutes: 20, gapMinutes: 5 }] } }, retry() {} };
const page = await load('src/features/meeting-point/MeetingPointPage.tsx', {
  './hooks/useMeetingRoom': 'export const useMeetingRoom = () => globalThis.__meetingFixture;',
  './hooks/useServerCommonGround': 'export const useServerCommonGround = () => globalThis.__meetingGround;',
  '@/features/reachability': 'import React from "react"; export const BaseMap = props => <div className="meeting-fixture-map" data-origin-pin={String(props.showOriginPin)}>{props.children}</div>; export const TimeBudgetSelector = () => <div>15 · 30 · 45 · 60 min</div>; export const LocationSearch = () => <input aria-label="Search starting point" placeholder="Search station, stop or place"/>;',
  '@/features/reachability/reachabilityService': 'export const isInStudyArea = () => true; export const formatCoord = () => "Saved starting point"; export const hitName = () => ""; export const originFromHit = () => null;',
  './components/RankedPlaceMarkers': 'export const FocusOnPlace = () => null; export const RankedPlaceMarkers = () => null;',
  './components/SharedMeetingMap': 'export const SharedMeetingMap = () => null;',
  './components/MeetingRadarLayer': 'export const MeetingRadarLayer = () => <div role="status" aria-label="Calculating common reachable area"/>;',
  './components/SharedParticipantAreasLayer': 'export const SharedParticipantAreasLayer = () => null;',
  './components/OverlapLayer': 'export const OverlapLayer = () => null;',
  '@/features/outing-pass/components/MeetingTravelPass': 'export const MeetingTravelPass = () => null;',
  './components/ShareLink': 'import React from "react"; export const ShareLink = () => <p>Room ABCDEFGH · Invite your group</p>;',
  '@/features/outing-pass/components/passPresentation': 'export const malaysiaInputTime = iso => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0,16);',
  './venueService': 'export const VENUE_TYPES = [{id:"station",label:"Stations"},{id:"cafe",label:"Cafés"},{id:"restaurant",label:"Restaurants"},{id:"mall",label:"Malls"}];',
});
const markup = () => renderToStaticMarkup(React.createElement(page.MeetingPointPage));
assert.ok(markup().includes('✓ Ready')); checks++;
assert.ok(markup().includes('Not ready')); checks++;
assert.equal(markup().includes('longest 20 min'), false); checks++;
globalThis.__meetingFixture.view.members[1] = { ...globalThis.__meetingFixture.view.members[1], planningStatus: 'Ready', at: { lat: 3.15, lon: 101.7 } };
assert.ok(markup().includes('Proposed by Jia Wei')); checks++;
assert.equal(markup().includes('Confirm for everyone'), false); checks++;
assert.equal(markup().includes('Check needed'), false); checks++;
assert.ok(markup().includes('data-origin-pin="false"')); checks++;
assert.equal(markup().includes('Shared departure'), false); checks++;
assert.ok(markup().includes('Meeting time')); checks++;
assert.equal(markup().includes('Start group planning'), false); checks++;
const settledGround = globalThis.__meetingGround.state;
globalThis.__meetingGround.state = { status: 'loading' };
assert.ok(markup().includes('Calculating common reachable area')); checks++;
assert.equal(markup().includes('longest 20 min'), false); checks++;
globalThis.__meetingGround.state = settledGround;
globalThis.__meetingGround.state = { status: 'loading', result: { ...settledGround.result, status: 'finding_places', proposals: [] } };
assert.ok(markup().includes('Shared area ready. Still finding places')); checks++;
assert.equal(markup().includes('Calculating common reachable area'), false); checks++;
assert.equal(markup().includes('>Propose<'), false); checks++;
globalThis.__meetingGround.state = { status: 'failed', message: 'Place route checks timed out.', result: { ...settledGround.result, status: 'finding_places', proposals: [] } };
assert.ok(markup().includes('Place route checks timed out')); checks++;
assert.ok(markup().includes('Shared reachability')); checks++;
assert.equal(markup().includes('>Propose<'), false); checks++;
globalThis.__meetingGround.state = settledGround;
globalThis.__meetingFixture.view.room.confirmedPlan = { version: 1, venue, arrivalTime: '2026-10-20T09:00:00+08:00' };
assert.ok(markup().includes('Generate my travel pass')); checks++;
assert.equal(markup().includes('No personal Pass checks are run here'), false); checks++;
globalThis.__meetingFixture.view.room.confirmedPlan = null;
globalThis.__meetingFixture.view.room.voteStatus = 'tie';
assert.ok(markup().includes('The vote is tied')); checks++;
globalThis.__meetingFixture.view.votes = [{ memberId: 'b', displayName: 'Jia Wei', venue, arrivalTime: '2026-10-20T09:00:00+08:00' }];
assert.ok(markup().includes('1/2 voted')); checks++;
assert.ok(markup().includes('Voted: Jia Wei')); checks++;
globalThis.__meetingGround.state.result.roomRevision = 3;
assert.equal(markup().includes('longest 20 min'), false); checks++;
globalThis.__meetingGround.state.result.roomRevision = 4;
// Failed persistence retains the local draft; successful persistence alone clears it.
const originalView = globalThis.__meetingFixture.view;
const originalSave = globalThis.__meetingFixture.setMyPoint;
globalThis.__meetingFixture.view = { ...originalView, me: { ...originalView.me, at: null },
  members: originalView.members.map(member => member.isSelf ? { ...member, at: null, planningStatus: 'Not ready' } : member) };
let pointSaves = 0;
globalThis.__meetingFixture.setMyPoint = async () => { pointSaves++; return false; };
let planner;
await act(async () => { planner = create(React.createElement(page.MeetingPointPage)); });
const startingControl = () => planner.root.find(node => typeof node.props.onShare === 'function' && Object.hasOwn(node.props, 'draft'));
await act(async () => { startingControl().props.onSelect({ at: { lat: 3.13, lon: 101.68 }, source: 'map', label: 'Selected station' }); });
assert.equal(pointSaves, 0); checks++;
assert.ok(startingControl().props.draft); checks++;
await act(async () => { startingControl().props.onShare(); });
assert.equal(pointSaves, 1); checks++;
assert.ok(startingControl().props.draft); checks++;
assert.equal(globalThis.__meetingFixture.view.members[0].planningStatus, 'Not ready'); checks++;
globalThis.__meetingFixture.setMyPoint = async point => {
  pointSaves++;
  globalThis.__meetingFixture.view.me.at = point.at;
  globalThis.__meetingFixture.view.members[0].at = point.at;
  globalThis.__meetingFixture.view.members[0].planningStatus = 'Ready';
  return true;
};
await act(async () => { startingControl().props.onShare(); });
assert.equal(pointSaves, 2); checks++;
assert.equal(startingControl().props.draft, null); checks++;
assert.equal(globalThis.__meetingFixture.view.members[0].planningStatus, 'Ready'); checks++;
await act(async () => { planner.unmount(); });
globalThis.__meetingFixture.view = originalView;
globalThis.__meetingFixture.setMyPoint = originalSave;
const originalPropose = globalThis.__meetingFixture.proposeVenue;
globalThis.__meetingFixture.proposeVenue = async () => { throw new Error('Controlled fixture failure'); };
await act(async () => { planner = create(React.createElement(page.MeetingPointPage)); });
const proposeButton = () => planner.root.findAllByType('button').find(button => button.children.includes('Propose'));
const markerControl = () => planner.root.find(node => Array.isArray(node.props.places) && Object.hasOwn(node.props, 'selectedId'));
await act(async () => { proposeButton().props.onClick(); });
assert.equal(markerControl().props.selectedId, null); checks++;
globalThis.__meetingFixture.proposeVenue = async () => {};
await act(async () => { proposeButton().props.onClick(); });
assert.equal(markerControl().props.selectedId, venue.id); checks++;
const baseScene = planner.root.find(node => Object.hasOwn(node.props, 'cityRegions'));
assert.ok(baseScene.props.cityRegions.length > 0); checks++;
assert.equal(baseScene.props.showOriginPin, false); checks++;
assert.ok(baseScene.props.waypoints.some(point => point.label.includes('Proposed: Jia Wei'))); checks++;
assert.equal(baseScene.props.cityFocus.label, venue.name); checks++;
await act(async () => { planner.root.findByProps({ 'aria-label': 'Fit all members on the map' }).props.onClick(); });
assert.equal(planner.root.find(node => Object.hasOwn(node.props, 'cityRegions')).props.cityFrameRequest, 1); checks++;
globalThis.__meetingFixture.view = { ...originalView, room: { ...originalView.room, planningRevision: 5 } };
await act(async () => { planner.update(React.createElement(page.MeetingPointPage)); });
assert.equal(markerControl().props.selectedId, null); checks++;
assert.equal(markerControl().props.places.length, 0); checks++;
await act(async () => { planner.unmount(); });
globalThis.__meetingFixture.proposeVenue = originalPropose;
globalThis.__meetingFixture.view = { status: 'checking', code: 'ABCDEFGH' };
globalThis.__meetingFixture.error = 'schema_required';
assert.ok(markup().includes('meeting-auto-planning SQL migration')); checks++;
assert.equal(markup().includes('Opening room'), false); checks++;
globalThis.__meetingFixture.view = originalView;
globalThis.__meetingFixture.error = null;
// A locally filtered shortlist must explain missing categories, not imply no malls exist.
await act(async () => { planner = create(React.createElement(page.MeetingPointPage)); });
const categoryButton = label => planner.root.findAllByType('button').find(button => button.children.includes(label));
const renderedText = () => JSON.stringify(planner.toJSON());
for (const label of ['Stations', 'Cafés', 'Restaurants']) {
  await act(async () => { categoryButton(label).props.onClick(); });
}
assert.ok(renderedText().includes('No verified places for the selected types in this shortlist')); checks++;
assert.equal(planner.root.findByProps({ 'aria-label': 'Verified places in this shortlist' }).children.join(''), '0 verified'); checks++;
assert.equal(categoryButton('Malls').props['aria-pressed'], true); checks++;
const savedResult = globalThis.__meetingGround.state.result;
globalThis.__meetingGround.state.result = { ...savedResult, proposals: [...savedResult.proposals, { rank: 2, venue: { ...venue, id: 'mall-test', type: 'mall', name: 'Test Mall' }, longestMinutes: 25, gapMinutes: 4 }] };
await act(async () => { planner.update(React.createElement(page.MeetingPointPage)); });
assert.ok(renderedText().includes('Test Mall')); checks++;
assert.equal(planner.root.findByProps({ 'aria-label': 'Verified places in this shortlist' }).children.join(''), '1 verified'); checks++;
assert.ok(renderedText().includes('This is not a count of all reachable places')); checks++;
assert.equal(renderedText().includes('No verified places for the selected types'), false); checks++;
await act(async () => { categoryButton('Malls').props.onClick(); });
assert.equal(categoryButton('Malls').props['aria-pressed'], true); checks++;
await act(async () => { planner.unmount(); });
globalThis.__meetingGround.state.result = savedResult;
// More is explicit, is disabled while computing, and keeps the old verified cards.
const moreState = globalThis.__meetingGround.state;
let moreCalls = 0;
let moreTypes;
globalThis.__meetingGround.loadMore = types => { moreCalls++; moreTypes = [...types].sort(); };
globalThis.__meetingGround.state = { status: 'ready', result: { ...savedResult, hasMore: true, searchPage: 0 } };
await act(async () => { planner = create(React.createElement(page.MeetingPointPage)); });
await act(async () => { planner.root.findAllByType('button').find(button => button.children.includes('Find more places')).props.onClick(); });
assert.equal(moreCalls, 1); checks++;
assert.deepEqual(moreTypes, ['cafe', 'mall', 'restaurant', 'station']); checks++;
globalThis.__meetingGround.loadingMore = true;
globalThis.__meetingGround.state = { status: 'loading', result: { ...savedResult, hasMore: true } };
await act(async () => { planner.update(React.createElement(page.MeetingPointPage)); });
assert.equal(planner.root.findAllByType('button').find(button => button.children.includes('Finding more…')).props.disabled, true); checks++;
assert.ok(renderedText().includes(venue.name)); checks++;
globalThis.__meetingGround.loadingMore = false;
globalThis.__meetingGround.state = { status: 'ready', result: { ...savedResult, hasMore: false } };
await act(async () => { planner.update(React.createElement(page.MeetingPointPage)); });
assert.ok(renderedText().includes('All candidates in this screened set checked')); checks++;
globalThis.__meetingGround.searchTypesKey = 'cafe,mall,restaurant,station';
await act(async () => { categoryButton('Stations').props.onClick(); });
await act(async () => { planner.root.findAllByType('button').find(button => button.children.includes('Search selected types')).props.onClick(); });
assert.deepEqual(moreTypes, ['cafe', 'mall', 'restaurant']); checks++;
await act(async () => { planner.unmount(); });
globalThis.__meetingGround.state = moreState;
delete globalThis.__meetingGround.loadMore;
delete globalThis.__meetingGround.loadingMore;
delete globalThis.__meetingGround.searchTypesKey;
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
