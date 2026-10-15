import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env': '{}' }, alias: { '@': `${process.cwd()}/src` }, logLevel: 'silent',
    plugins: [{ name: 'presentation-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/presentation-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/presentation-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(result.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const helpers = await load('src/features/outing-pass/components/legPresentation.ts');
check(helpers.stopLabel('SJ68 TAMAN SUBANG PERMAI (UTARA)'), { code: 'SJ68', name: 'Taman Subang Permai (Utara)' });
check(helpers.stopLabel('SJ68 Taman Subang Permai (Utara)'), { code: 'SJ68', name: 'Taman Subang Permai (Utara)' });
check(helpers.stopLabel('STESEN LRT USJ 7'), { code: null, name: 'Stesen LRT USJ 7' });
check(helpers.stopLabel("McDonald's"), { code: null, name: "McDonald's" });
check(helpers.minutesLabel(0), '0 min');
check(helpers.countdownLabel('2026-10-15T14:06:00+08:00', Date.parse('2026-10-15T13:02:00+08:00')), 'Leave in 1 h 4 min');
check(helpers.countdownLabel('2026-10-15T14:06:00+08:00', Date.parse('2026-10-15T14:09:00+08:00')), 'Suggested departure passed 3 min ago');
check(helpers.legKind({ mode: 'BUS' }), 'bus');
check(helpers.legKind({ mode: 'SUBWAY' }), 'rail');
check(helpers.legKind({ mode: 'FERRY' }), 'transit');
check(helpers.legKind({ mode: 'UNKNOWN' }), 'transit');
check(helpers.legKind({ mode: 'SUBWAY', routeType: 3 }), 'bus');
check(helpers.legKind({ mode: 'BUS', routeType: 1 }), 'rail');
check(helpers.legKind({ mode: 'RAIL', routeType: 4 }), 'transit');
check(helpers.legColour({ mode: 'BUS', routeColor: '#93b5ff' }), '#93b5ff');
check(helpers.legColour({ mode: 'BUS', routeColor: 'invalid' }), '#60a5fa');
const bus = { id: 'bus', mode: 'BUS', routeShortName: 'T776', routeLongName: 'Stesen LRT USJ 7 ~ Subang Mewah', routeColor: '#93b5ff',
  durationSeconds: 300, distanceMeters: 1500, from: { name: 'SJ68 TAMAN SUBANG PERMAI (UTARA)' }, to: { name: 'SJ78 PANGSAPURI ANGSANA' },
  estimatedStartTime: '2026-10-15T14:09:00+08:00', estimatedEndTime: '2026-10-15T14:14:00+08:00', steps: [] };
check(helpers.legTitle(bus).title, 'Bus T776');
const { JourneyTimeline } = await load('src/features/outing-pass/components/JourneyTimeline.tsx');
const markup = renderToStaticMarkup(React.createElement(JourneyTimeline, { legs: [bus], originLabel: 'Start', destinationLabel: 'Bayu Cafe' }));
check(markup.includes('lucide-bus'), true);
check(markup.includes('lucide-train-front'), false);
check(markup.includes('TAMAN SUBANG'), false);
check(markup.includes('SJ68'), true);
const { RouteOptionCards } = await load('src/features/outing-pass/components/RouteOptionCards.tsx');
const options = [
  { id: 'bus', durationSeconds: 660, walkingSeconds: 420, walkingDistanceMeters: 550, transferCount: 0, leaveTime: bus.estimatedStartTime },
  { id: 'walk', durationSeconds: 1080, walkingSeconds: 1080, walkingDistanceMeters: 1400, transferCount: 0, leaveTime: bus.estimatedStartTime },
];
check(helpers.optionHighlights(options).get('bus'), ['Fastest', 'Least walking']);
let selected; let view;
await act(async () => { view = create(React.createElement(RouteOptionCards, { options, selectedId: 'bus', onSelect: id => { selected = id; } })); });
check(view.root.findAllByType('button')[0].props['aria-pressed'], true);
await act(async () => { view.root.findAllByType('button')[1].props.onClick(); });
check(selected, 'walk');
check(JSON.stringify(view.toJSON()).includes('1.4 km'), true);
await act(async () => view.unmount());
// Parse the real OTP boundary, including absent/malformed intermediate stops.
const originalFetch = globalThis.fetch;
let intermediateStops = [{ name: 'Intermediate', lat: 3.1, lon: 101.6 }];
const requests = [];
globalThis.fetch = async request => {
  const url = new URL(request, 'https://fixture.invalid'); requests.push(url);
  const mode = url.searchParams.get('mode') === 'WALK' ? 'WALK' : 'SUBWAY';
  return { ok: true, json: async () => ({ plan: { itineraries: [{ duration: 300, legs: [{ mode,
    routeType: mode === 'WALK' ? -1 : 3, intermediateStops, from: { name: 'Start', lat: 3.1, lon: 101.6 }, to: { name: 'End', lat: 3.11, lon: 101.61 } }] }] } }) };
};
const { routeArriveByJourneys } = await load('src/shared/services/transitRoutingClient.ts');
const route = () => routeArriveByJourneys({ lat: 3.1, lon: 101.6 }, { lat: 3.11, lon: 101.61 }, '2026-10-15T14:28:00+08:00');
let journeys = await route();
check(journeys.find(journey => journey.legs[0].mode === 'SUBWAY').legs[0].stopCount, 2);
check(journeys.find(journey => journey.legs[0].mode === 'SUBWAY').legs[0].routeType, 3);
check(journeys.find(journey => journey.legs[0].mode === 'WALK').legs[0].stopCount, null);
check(requests.find(url => url.searchParams.get('mode') !== 'WALK').searchParams.get('showIntermediateStops'), 'true');
intermediateStops = undefined; journeys = await route();
check(journeys.find(journey => journey.legs[0].mode === 'SUBWAY').legs[0].stopCount, null);
intermediateStops = []; journeys = await route();
check(journeys.find(journey => journey.legs[0].mode === 'SUBWAY').legs[0].stopCount, 1);
intermediateStops = [{}]; journeys = await route();
check(journeys.find(journey => journey.legs[0].mode === 'SUBWAY').legs[0].stopCount, null);
globalThis.fetch = originalFetch;
const originalWindow = globalThis.window;
globalThis.window = { setInterval: () => 1, clearInterval() {} };
const { TravelPassContent } = await load('src/features/outing-pass/components/TravelPassContent.tsx', {
  './PrivateJourneyMap': 'export const PrivateJourneyMap = ({sheetCoverage}) => <div data-coverage={sheetCoverage}/>;',
  '../passExport': 'export const downloadPassImage = async () => {};',
});
const pass = { selectedJourneyId: 'bus', legs: [bus], leaveTime: bus.estimatedStartTime, estimatedArrivalTime: bus.estimatedEndTime,
  meeting: { arrivalTime: '2026-10-15T14:28:00+08:00', venue: { name: 'Bayu Cafe' } } };
await act(async () => { view = create(React.createElement(TravelPassContent, { pass, options, originLabel: 'Start', onSelectJourney() {}, onRecheck() {} })); });
check(view.root.findByProps({ 'data-coverage': 0.64 }).type, 'div');
const toggle = view.root.findByProps({ 'aria-controls': 'travel-pass-details' });
check(toggle.props['aria-expanded'], true);
await act(async () => toggle.props.onClick());
check(view.root.findByProps({ 'aria-controls': 'travel-pass-details' }).props['aria-expanded'], false);
check(view.root.findByProps({ 'data-coverage': 0.35 }).type, 'div');
await act(async () => view.unmount());
globalThis.window = originalWindow;
console.log(`Travel pass presentation checks passed: ${checks}. Synthetic fixtures, no network or room writes.`);
