import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], alias: { '@': `${process.cwd()}/src` }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'experience-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/experience-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/experience-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); checks++; };
const oldWindow = globalThis.window;
let url = 'https://example.test/?meet=ABCDEFGH&keep=value';
globalThis.window = { location: { get href() { return url; }, get search() { return new URL(url).search; } }, history: { replaceState(_state, _title, value) { url = value.toString(); } } };
const { openRoomFromPass } = await load('src/features/meeting-point/roomLink.ts');
openRoomFromPass(); check(new URL(url).searchParams.get('meet'), 'ABCDEFGH');
openRoomFromPass(''); check(new URL(url).searchParams.get('meet'), 'ABCDEFGH');
openRoomFromPass('DEMN2345'); check(new URL(url).searchParams.get('meet'), 'DEMN2345');
check(new URL(url).searchParams.get('keep'), 'value');
assert.throws(() => openRoomFromPass('invalid'), /invalid/); checks++;
check(new URL(url).searchParams.get('meet'), 'DEMN2345');
const { MyPassesPage } = await load('src/features/outing-pass/components/MyPassesPage.tsx', {
  '@/features/meeting-point/supabaseClient': 'export const supabase = {auth:{getSession:async()=>({data:{session:{user:{id:"fixture"}}}})}};',
  '@/features/meeting-point/roomService': 'export const loadRoom = async () => null;',
  '../passStorage': 'export const listStoredPasses = () => [];',
});
let page; let code = 'not-clicked';
await act(async () => { page = create(React.createElement(MyPassesPage, { onOpenRoom: value => { code = value; openRoomFromPass(value); } })); });
await act(async () => { page.root.findAllByType('button').find(button => button.children.includes('Go to Meet')).props.onClick(); });
check(code, undefined); check(new URL(url).searchParams.get('meet'), 'DEMN2345');
await act(async () => { page.unmount(); }); globalThis.window = oldWindow;

const leafletStubs = {
  'react-leaflet': `import React from 'react'; export const Marker = p => <div className={p.icon.className} data-icon={p.icon.html} data-rank={p.title}>{p.children}</div>;
    export const CircleMarker = p => <div data-member="true">{p.children}</div>;
    export const Tooltip = p => <label>{p.children}</label>; export const Polygon = () => <span data-polygon="true"/>; export const useMap = () => ({});`,
  'leaflet': 'export const divIcon = value => value; export const latLngBounds = () => ({});',
  '@/shared/hooks': 'export const usePrefersReducedMotion = () => true;',
};
const { RankedPlaceMarkers } = await load('src/features/meeting-point/components/RankedPlaceMarkers.tsx', leafletStubs);
const venue = { id: 'fixture', type: 'station', name: 'Synthetic station', lat: 3.1, lon: 101.6 };
const markers = selections => renderToStaticMarkup(React.createElement(RankedPlaceMarkers, { places: [{ rank: 7, venue }], selectedId: null, onSelect() {}, selections }));
check(markers([]).includes('meeting-proposed-pin'), false);
check(markers([{ venue, displayName: 'Ming', memberId: 'b' }]).includes('meeting-proposed-pin'), true);
check(markers([{ venue, displayName: 'Ming', memberId: 'b' }]).includes('Ming'), true);
check(markers([{ venue, displayName: '<img onerror=x>', memberId: 'b' }]).includes('&lt;img onerror=x&gt;'), true);
check(markers([]).includes('7. Synthetic station'), true);
const { SharedMeetingMap } = await load('src/features/meeting-point/components/SharedMeetingMap.tsx', leafletStubs);
const { meetingMapWaypoints } = await load('src/features/meeting-point/meetingMapWaypoints.ts');
const sharedScene = meetingMapWaypoints([{id:'a', displayName:'Aina', at:venue, isSelf:true}, {id:'b', displayName:'Ming', at:venue}], [{venue,rank:7}], [{venue,memberId:'b',displayName:'Ming'}]);
check(sharedScene.length, 1); check(sharedScene[0].lat, venue.lat); check(sharedScene[0].lon, venue.lon);
check(sharedScene[0].label.includes('Aina (you) · Ming'), true);
check(sharedScene[0].label.includes('Proposed: Ming'), true); check(sharedScene[0].colour, '#fbbf24');
const memberMap = renderToStaticMarkup(React.createElement(SharedMeetingMap, { members: [{ id: 'a', at: venue, displayName: 'Aina' }], areas: [{ regions: [{ outer: [] }] }], frameRequest: 0 }));
check(memberMap.includes('data-polygon'), false); check(memberMap.includes('data-member'), true);
const { MeetingRadar } = await load('src/features/meeting-point/components/MeetingRadar.tsx');
const radar = renderToStaticMarkup(React.createElement(MeetingRadar));
check(radar.includes('role="status"'), true); check(radar.includes('meeting-radar-sweep'), true);
check(readFileSync('src/index.css', 'utf8').includes('.meeting-radar-sweep { animation: none; }'), true);

// Exercise the real canvas layout with a controlled drawing context, no browser or network.
const { drawPassCanvas, imageTextLines } = await load('src/features/outing-pass/passImageRenderer.ts');
const texts = []; const drawCalls = [];
const context = new Proxy({ font: '', measureText: text => ({ width: text.length * 14 }), fillText: (text, x, y) => texts.push({ text, x, y }),
  createLinearGradient: () => ({ addColorStop() {} }) }, { get(target, key) { return key in target ? target[key] : (...args) => drawCalls.push([key, args]); } });
const originalDocument = globalThis.document;
const canvas = { getContext: () => context, width: 0, height: 0 };
globalThis.document = { createElement: () => canvas };
const pass = { roomCode: 'ABCDEFGH', planVersion: 2, evidenceMode: 'route-only', meeting: { venue: { name: 'A very long synthetic meeting venue name '.repeat(4) }, arrivalTime: '2026-10-20T18:30:00+08:00' },
  leaveTime: '2026-10-20T18:00:00+08:00', estimatedArrivalTime: '2026-10-20T18:20:00+08:00', checkedAt: '2026-10-15T08:00:00+08:00',
  legs: [{ mode: 'WALK', geometry: [{lat:3.1,lon:101.6},{lat:3.11,lon:101.61}], durationSeconds: 1200, routeShortName: null, startTimeMs: Date.parse('2026-10-20T18:00:00+08:00'), from:{name:'Synthetic start'},to:{name:'Synthetic end'} }],
  walking: { totalSeconds: 1200, directions: [{relativeDirection:'CONTINUE',streetName:'Synthetic street',distanceMeters:800}] } };
drawPassCanvas(pass, {});
check(canvas.width, 1200); check(texts.every(item => item.y < canvas.height), true);
check(texts.some(item => item.text === 'JOURNEY TIMELINE'), true);
check(texts.some(item => item.text === 'YOUR ROUTE'), true);
check(drawCalls.some(([name]) => name === 'drawImage'), true);
check(texts.some(item => item.text.includes('not checked')), true);
check(imageTextLines(context, '没有空格的很长的中文名字', 56).every(line => line.length <= 4), true);
const previousPaths = drawCalls.filter(([name]) => name === 'lineTo').length;
pass.legs[0].geometry = []; texts.length = 0; drawPassCanvas(pass, {});
check(texts.some(item => item.text.includes('Route geometry unavailable')), true);
check(drawCalls.filter(([name]) => name === 'lineTo').length, previousPaths + 1); // Divider only; no invented route.
globalThis.document = originalDocument;
console.log(`Meeting experience checks passed: ${checks}. Controlled UI/canvas fixtures, no cloud writes.`);
