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
globalThis.window = { setInterval: () => 1, clearInterval() {}, location: { get href() { return url; }, get search() { return new URL(url).search; } }, history: { replaceState(_state, _title, value) { url = value.toString(); } } };
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
  '../passStorage': 'export const listStoredPasses = () => []; export const loadStoredPass = () => null;',
  './SavedTravelPass': 'export const SavedTravelPass = () => null;',
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
const mockTextWidth = (value, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  return Array.from(value).reduce((width, character) => width + (/[^\x00-\xff]/.test(character) ? size : size * 0.58), 0);
};
let context;
context = new Proxy({ font: '', measureText: text => ({ width: mockTextWidth(text, context.font) }),
  fillText: (text, x, y) => texts.push({ text, x, y, width: mockTextWidth(text, context.font) }),
  createLinearGradient: () => ({ addColorStop() {} }) }, { get(target, key) { return key in target ? target[key] : (...args) => drawCalls.push([key, args]); } });
const originalDocument = globalThis.document;
const canvas = { getContext: () => context, width: 0, height: 0 };
globalThis.document = { createElement: () => canvas };
const pass = { roomCode: 'ABCDEFGH', planVersion: 2, evidenceMode: 'route-only', meeting: { venue: { name: 'A very long synthetic meeting venue name '.repeat(4) }, arrivalTime: '2026-10-20T18:30:00+08:00' },
  leaveTime: '2026-10-20T18:00:00+08:00', estimatedArrivalTime: '2026-10-20T18:20:00+08:00', checkedAt: '2026-10-15T08:00:00+08:00',
  legs: [
    { mode: 'WALK', geometry: [{lat:3.1,lon:101.6},{lat:3.11,lon:101.61}], durationSeconds: 240, distanceMeters: 300, routeShortName: null, routeLongName: null, routeColor: null, transitLeg: false, startTimeMs: Date.parse('2026-10-20T18:00:00+08:00'), estimatedStartTime: null, from:{name:'Synthetic start'},to:{name:'SJ68 TAMAN SUBANG PERMAI (UTARA)'} },
    { mode: 'BUS', geometry: [{lat:3.11,lon:101.61},{lat:3.12,lon:101.62}], durationSeconds: 300, distanceMeters: 2800, stopCount: 5, routeShortName: 'T776', routeLongName: 'Stesen LRT USJ 7 ~ Subang Mewah', routeColor: '#93b5ff', transitLeg: true, startTimeMs: Date.parse('2026-10-20T18:04:00+08:00'), estimatedStartTime: null, from:{name:'SJ68 TAMAN SUBANG PERMAI (UTARA)'},to:{name:`SJ78 ${'BOUNDARYCHECK '.repeat(15)}终点站终点站终点站终点站`} },
  ],
  walking: { totalSeconds: 1200, directions: [{relativeDirection:'CONTINUE',streetName:'Synthetic street',distanceMeters:800}] } };
drawPassCanvas(pass, {});
check(canvas.width, 1200); check(texts.every(item => item.y < canvas.height), true);
check(texts.some(item => item.text === 'JOURNEY TIMELINE'), true);
check(texts.some(item => item.text === 'YOUR ROUTE'), true);
check(drawCalls.some(([name]) => name === 'drawImage'), true);
check(texts.map(item => item.text).join(' ').includes('not checked'), true);
check(texts.some(item => item.text === 'Bus T776'), true);
check(texts.some(item => item.text === '5 stops'), true);
check(texts.some(item => item.text === 'SJ68'), true);
check(texts.some(item => item.text.includes('Taman Subang Permai')), true);
const longStopLines = texts.filter(item => /Boundarycheck|终点站/.test(item.text));
check(longStopLines.length > 1, true);
check(longStopLines.every(item => item.x + item.width <= 1200 - 64), true);
check(imageTextLines(context, '没有空格的很长的中文名字', 56).every(line => line.length <= 4), true);
const { minutesLabel } = await load('src/features/outing-pass/components/legPresentation.ts');
for (const [seconds, expected] of [[0, '0 min'], [360, '6 min'], [380, '7 min'], [360.001, '7 min'], [3600, '1 h'], [3601, '1 h 1 min']]) {
  texts.length = 0;
  drawPassCanvas({ ...pass, estimatedArrivalTime: new Date(Date.parse(pass.leaveTime) + seconds * 1000).toISOString() }, {});
  check(minutesLabel(seconds), expected);
  check(texts.some(item => item.text === `${expected} journey`), true);
}
const previousPaths = drawCalls.filter(([name]) => name === 'lineTo').length;
pass.legs.forEach(leg => { leg.geometry = []; }); texts.length = 0; drawPassCanvas(pass, {});
check(texts.some(item => item.text.includes('Route geometry unavailable')), true);
const missingGeometryPaths = drawCalls.filter(([name]) => name === 'lineTo').length - previousPaths;
check(missingGeometryPaths < previousPaths, true); // Static layout remains, but no route segments are invented.
texts.length = 0; drawCalls.length = 0;
drawPassCanvas({ ...pass, zeroTravel: true, legs: [], leaveTime: pass.estimatedArrivalTime,
  walking: { totalSeconds: 0, directions: [] } }, {});
check(texts.some(item => item.text === 'No travel needed'), true);
check(texts.some(item => item.text.includes('starting point is the meeting point')), true);
check(texts.every(item => item.y < canvas.height), true);
texts.length = 0; drawCalls.length = 0;
const backdropCanvas = { fixture: 'public-building-map' };
const mappedPass = { ...pass, legs: [{ ...pass.legs[0], geometry: [{lat:3.1,lon:101.6},{lat:3.11,lon:101.61}] }] };
drawPassCanvas(mappedPass, {}, { canvas: backdropCanvas, paths: [[[100, 60], [700, 130]]] });
check(texts.some(item => item.text.includes('street map')), true);
check(texts.some(item => item.text.includes('© OpenStreetMap contributors')), true);
check(drawCalls.some(([name, args]) => name === 'drawImage' && args[0] === backdropCanvas), true);
check(drawCalls.some(([name, args]) => name === 'moveTo' && args[0] === 194), true); // plot origin 94 + camera x 100
texts.length = 0;
drawPassCanvas(mappedPass, {}, null);
check(texts.some(item => item.text.includes('Street map unavailable')), true);
globalThis.document = originalDocument;

// Map snapshot lifecycle: public tiles only, matched camera coordinates, bounded wait, cleanup.
const mapDocument = globalThis.document;
const mapFetch = globalThis.fetch;
const oldFixture = globalThis.passMapFixture;
const fixture = { removedMaps: 0, removedHosts: 0, fetches: 0, options: null, stall: false, zoom: 17.5, cameras: [], tightened: false };
globalThis.passMapFixture = fixture;
globalThis.document = {
  body: { appendChild() {} },
  createElement: tag => tag === 'canvas' ? { getContext: () => ({ drawImage() {} }) }
    : { style: {}, setAttribute() {}, remove() { fixture.removedHosts++; } },
};
globalThis.fetch = async () => {
  fixture.fetches++;
  return { ok: true, json: async () => ({ version:8, sources:{public:{type:'vector'}}, glyphs:'https://tiles.example.test/fonts/{fontstack}/{range}.pbf',
    layers:[{id:'building',type:'fill',source:'public'},{id:'highway_minor',type:'line',source:'public'}] }) };
};
const { renderPassRouteMap } = await load('src/features/outing-pass/passRouteMap.ts', {
  'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url': 'export default "fixture-worker";',
  'maplibre-gl': `export const setWorkerUrl = () => {};
    export class Map {
      constructor(options) { globalThis.passMapFixture.options = options; }
      once(event, cb) { if (event === 'load' || event === 'idle' && !globalThis.passMapFixture.stall) queueMicrotask(cb); }
      fitBounds() {} triggerRepaint() {} getZoom() { return globalThis.passMapFixture.zoom; }
      getCenter() { return [101.6,3.1]; } unproject() { return [101.61,3.11]; }
      jumpTo(camera) { const f=globalThis.passMapFixture; f.cameras.push(camera); f.tightened=camera.zoom>f.zoom; }
      project(point) { return {x:globalThis.passMapFixture.tightened ? -5 : point[0],y:point[1]}; }
      getCanvas() { return {}; } remove() { globalThis.passMapFixture.removedMaps++; }
    }`,
});
const backdrop = await renderPassRouteMap(mappedPass);
check(backdrop.paths[0], [[101.6, 3.1], [101.61, 3.11]]);
check(fixture.removedMaps, 1); check(fixture.removedHosts, 1);
check(fixture.options.canvasContextAttributes.preserveDrawingBuffer, true);
check(fixture.options.style.layers.some(layer => layer.type === 'fill-extrusion'), false);
check(fixture.options.style.layers.some(layer => layer.id === 'highway_minor'), true);
check(fixture.options.pitch, 0);
check(fixture.options.style.glyphs.includes('fonts'), true);
check(Object.values(fixture.options.style.sources).some(source => source.type === 'geojson'), false);
check(await renderPassRouteMap({ ...mappedPass, zeroTravel: true }), null);
check(fixture.fetches, 1);
const nativeSetTimeout = globalThis.setTimeout;
fixture.stall = true;
globalThis.setTimeout = callback => nativeSetTimeout(callback, 10);
try { check(await renderPassRouteMap(mappedPass), null); }
finally { globalThis.setTimeout = nativeSetTimeout; }
check(fixture.removedMaps, 2); check(fixture.removedHosts, 2);
fixture.stall = false; fixture.zoom = 15;
check((await renderPassRouteMap(mappedPass)).canvas.width, 1012);
check(fixture.cameras.length, 2); // Clipped tighter framing must revert to the safe camera.
check(fixture.cameras[1].zoom, 15);
globalThis.fetch = async () => { throw new Error('offline'); };
check(await renderPassRouteMap(mappedPass), null);
globalThis.document = mapDocument;
globalThis.fetch = mapFetch;
globalThis.passMapFixture = oldFixture;
console.log(`Meeting experience checks passed: ${checks}. Controlled UI/canvas fixtures, no cloud writes.`);
