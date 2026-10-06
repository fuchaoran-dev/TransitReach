import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');
globalThis.__uiAudit = {};
async function load(entry, stubs = {}) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
    plugins: [{ name: 'controlled-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/state-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/state-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function mount(useModel, props) {
  let model; let view;
  function Probe(input) { model = useModel(input); return null; }
  await act(async () => { view = create(React.createElement(Probe, props)); });
  return {
    get model() { return model; },
    async update(next) { await act(async () => view.update(React.createElement(Probe, next))); },
    async close() { await act(async () => view.unmount()); },
  };
}

// Deliberately resolve an aborted request: stale results must be ignored even if
// an upstream implementation fails to honour AbortSignal.
const coverage = []; const estimates = [];
const audit = globalThis.__uiAudit;
audit.compute = () => { const task = deferred(); coverage.push(task); return task.promise; };
audit.estimate = () => { const task = deferred(); estimates.push(task); return task.promise; };
audit.loadServices = () => [];
const { useRealEssentialServices } = await load('src/features/essential-services/hooks/useRealEssentialServices.ts', {
  '@/shared/data/adapters/routingAdapter': 'export const computeReachability = globalThis.__uiAudit.compute; export const estimateTravelTime = globalThis.__uiAudit.estimate;',
  '@/shared/data/adapters/essentialServicesAdapter': 'export const loadEssentialServices = () => globalThis.__uiAudit.loadServices();',
});
const origin = { lat: 3.07, lon: 101.6 };
const service = { id: 'hospital', name: 'Fixture hospital', category: 'hospital', lat: 3.08, lon: 101.61, hours: '24/7', estimatedTravelTime: 9 };
const initial = { origin, budget: 30, departure: '2026-10-03T09:00:00+08:00' };
const services = await mount(p => useRealEssentialServices(p.origin, p.budget, 'multimodal', p.departure), initial);
check(services.model.status, 'loading');
let estimatePromise;
await act(async () => { estimatePromise = services.model.estimateFor(service); });
await services.update({ ...initial, origin: null });
await act(async () => { coverage[0].resolve({ result: { regions: [] } }); estimates[0].resolve(9); await estimatePromise; });
check(services.model.status, 'idle'); check(services.model.travelTimes, {});
await services.update(initial);
await services.update({ ...initial, departure: '2026-10-04T09:00:00+08:00' });
await act(async () => coverage[1].resolve({ result: { regions: [] } }));
check(services.model.status, 'loading');
await act(async () => coverage[2].resolve({ result: { regions: [] } }));
check(services.model.status, 'ready');
await services.close();

// Finding 80 real services must not issue 80 background plan requests. Selecting a
// service is single-flight; a fresh coordinate object alone must not recompute coverage.
audit.loadServices = () => Array.from({ length: 80 }, (_, i) => ({ ...service, id: `place-${i}`, name: `Place ${i}` }));
const coverageStart = coverage.length; const estimateStart = estimates.length;
const demand = await mount(p => useRealEssentialServices(p.origin, p.budget, 'multimodal', p.departure), initial);
await act(async () => coverage[coverageStart].resolve({ result: { regions: [{ outer: [[101, 3], [102, 3], [102, 4], [101, 4], [101, 3]], holes: [] }] } }));
check(demand.model.services.length, 80); check(estimates.length, estimateStart);
let demandFirst; let demandSecond;
await act(async () => {
  demandFirst = demand.model.estimateFor(demand.model.services[0]);
  demandSecond = demand.model.estimateFor(demand.model.services[0]);
});
check(estimates.length, estimateStart + 1);
await act(async () => { estimates[estimateStart].resolve(9); await Promise.all([demandFirst, demandSecond]); });
check(demand.model.services[0].estimatedTravelTime, 9);
await demand.update({ ...initial, origin: { ...origin } }); check(coverage.length, coverageStart + 1);
await demand.update({ ...initial, departure: '2026-10-04T09:00:00+08:00' });
check(demand.model.travelTimes, {});
await demand.close();

// Service selection survives time/budget changes, but its old estimate does not.
audit.serviceData = { status: 'ready', error: null, services: [service], estimateFor: async () => {} };
const { useMapServices } = await load('src/pages/components/useMapServices.ts', {
  '@/features/essential-services': 'export const useRealEssentialServices = () => globalThis.__uiAudit.serviceData;',
  '@/shared/data': 'export const CATEGORY_META = { hospital: { label: "Hospitals" } };',
  '@/shared/data/adapters/routingAdapter': 'export const DEPARTURE_TIME = ""; export const TRAVEL_MODE = "multimodal";',
});
const selection = await mount(p => useMapServices(p.origin, 30, true, p.departure), initial);
await act(async () => selection.model.select(service));
check(selection.model.selected.id, 'hospital');
await act(async () => selection.model.hideDetails());
check(selection.model.detailsOpen, false);
audit.serviceData = { ...audit.serviceData, services: [], status: 'loading' };
await selection.update({ ...initial, departure: '2026-10-04T09:00:00+08:00' });
check(selection.model.selected.id, 'hospital'); check(selection.model.selected.estimatedTravelTime, undefined);
await act(async () => selection.model.clearSelection());
check(selection.model.selected, null);
await act(async () => selection.model.select(service));
await selection.update({ ...initial, origin: { lat: 3.12, lon: 101.7 } });
check(selection.model.selected, null);
await selection.close();

// The actual selection model must request an estimate again after a date change,
// including a retained place that is no longer in the new coverage.
audit.useServices = useRealEssentialServices;
const integrated = await load('src/pages/components/useMapServices.ts', {
  '@/features/essential-services': 'export const useRealEssentialServices = globalThis.__uiAudit.useServices;',
  '@/shared/data': 'export const CATEGORY_META = { hospital: { label: "Hospitals" } };',
  '@/shared/data/adapters/routingAdapter': 'export const DEPARTURE_TIME = ""; export const TRAVEL_MODE = "multimodal";',
});
const integratedStart = coverage.length; const integratedEstimates = estimates.length;
const integratedSelection = await mount(p => integrated.useMapServices(p.origin, p.budget, true, p.departure), initial);
await act(async () => coverage[integratedStart].resolve({ result: { regions: [{ outer: [[101, 3], [102, 3], [102, 4], [101, 4], [101, 3]], holes: [] }] } }));
await act(async () => integratedSelection.model.select(integratedSelection.model.displayed[0] ?? { ...service, id: 'place-0' }));
check(estimates.length, integratedEstimates + 1);
await act(async () => estimates[integratedEstimates].resolve(9));
check(integratedSelection.model.selected.estimatedTravelTime, 9);
await integratedSelection.update({ ...initial, departure: '2026-10-04T09:00:00+08:00' });
check(integratedSelection.model.selected.estimatedTravelTime, undefined);
await act(async () => coverage[integratedStart + 1].resolve({ result: { regions: [] } }));
check(estimates.length, integratedEstimates + 2);
await act(async () => estimates[integratedEstimates + 1].resolve(null));
check(integratedSelection.model.selected.estimatedTravelTime, null);
await integratedSelection.update({ ...initial, departure: '2026-10-04T09:00:00+08:00' });
check(estimates.length, integratedEstimates + 2);
await integratedSelection.close();

const requests = [];
audit.inspect = () => { const task = deferred(); requests.push(task); return task.promise; };
const { useJourneyInspection } = await load('src/features/interchange/hooks/useJourneyInspection.ts', {
  '../journeyInspectionService': 'export const inspectJourneys = globalThis.__uiAudit.inspect;',
  '@/shared/data/adapters/routingAdapter': 'export const DEPARTURE_TIME = "";',
});
const routes = await mount(p => useJourneyInspection(p.origin, service, 30, p.enabled, p.departure), { ...initial, enabled: true });
await act(async () => requests[0].resolve({ journeys: [{ id: 'old' }], rejectedJourneyCount: 0 }));
await act(async () => { routes.model.highlightJourney('old'); routes.model.highlightLeg('old-leg'); routes.model.focusStep({ lat: 3.08, lon: 101.6 }); });
await routes.update({ ...initial, enabled: true, departure: '2026-10-05T09:00:00+08:00' });
check(routes.model.focusedStep, null); check(routes.model.highlightedLegId, null); check(routes.model.highlightedJourneyId, null);
await routes.update({ ...initial, enabled: false });
await act(async () => requests[1].resolve({ journeys: [{ id: 'stale' }], rejectedJourneyCount: 0 }));
check(routes.model.status, 'idle'); check(routes.model.journeys, []);
await routes.close();

// Clearing the last location closes the native city surface.
audit.context = React.createContext(false);
const { CityFocusView } = await load('src/features/reachability/components/CityFocusView.tsx', {
  '@/pages/components/WeatherPlanning': 'export const MapDaylight = globalThis.__uiAudit.context;',
  './VectorBaseLayer': 'export const STYLE_URL = ""; export const trimStyle = x => x; export const applyMapDaylight = () => {};',
  'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url': 'export default "";',
  'maplibre-gl/dist/maplibre-gl.css': '',
  'maplibre-gl': 'export const Map = class {}; export const NavigationControl = class {}; export const setWorkerUrl = () => {};',
});
let scene;
await act(async () => { scene = create(React.createElement(CityFocusView, { origin: { at: origin }, service, regions: [] })); });
check(scene.root.findAllByType('section').length, 1);
await act(async () => scene.update(React.createElement(CityFocusView, { origin: null, service: null, regions: null })));
check(scene.root.findAllByType('section').length, 0);
await act(async () => scene.unmount());

const { VectorBaseLayer, trimStyle } = await load('src/features/reachability/components/VectorBaseLayer.tsx', {
  '@/pages/components/WeatherPlanning': 'export const MapDaylight = globalThis.__uiAudit.context;',
  'react-leaflet': 'import React from "react"; export const useMap = () => globalThis.__uiAudit.map; export const TileLayer = () => React.createElement("tile-fallback");',
  'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url': 'export default "";',
  'maplibre-gl/dist/maplibre-gl.css': '',
  'maplibre-gl': 'export const Map = class {}; export const setWorkerUrl = () => {};',
  'leaflet': 'export const DomUtil = {};',
});
const style = { version: 8, sources: {}, layers: [{ id: 'highway-name-major', type: 'symbol', source: 'fixture' }, { id: 'highway-name-minor', type: 'symbol', source: 'fixture' }] };
check(trimStyle(style, true).layers.length, 1);
check(trimStyle(style, true).layers[0].filter, ['match', ['get', 'class'], ['trunk', 'primary'], true, false]);
check(trimStyle(style, false).layers[0].filter, trimStyle(style, true).layers[0].filter);
const vectorFetch = globalThis.fetch; const vectorTimer = globalThis.setTimeout; const vectorClear = globalThis.clearTimeout;
const stalledStyle = deferred(); let expire; let styleSignal; let vector;
audit.map = {};
globalThis.fetch = (_, options) => { styleSignal = options.signal; return stalledStyle.promise; };
globalThis.setTimeout = callback => { expire = callback; return 1; }; globalThis.clearTimeout = () => {};
try {
  await act(async () => { vector = create(React.createElement(VectorBaseLayer)); });
  check(vector.root.findAllByType('tile-fallback').length, 0);
  await act(async () => expire());
  check(styleSignal.aborted, true); check(vector.root.findAllByType('tile-fallback').length, 1);
  await act(async () => stalledStyle.resolve({ ok: true, json: async () => style }));
  check(vector.root.findAllByType('tile-fallback').length, 1);
  await act(async () => vector.unmount());
} finally { globalThis.fetch = vectorFetch; globalThis.setTimeout = vectorTimer; globalThis.clearTimeout = vectorClear; }

// Refreshing the forecast must keep the current map weather while loading,
// then explicitly expose an upstream error rather than silently keep stale data.
const { useWeatherForecast } = await load('src/pages/components/WeatherPlanning.tsx');
const savedFetch = globalThis.fetch;
const savedInterval = globalThis.setInterval;
const savedClearInterval = globalThis.clearInterval;
let refresh;
const weatherRequests = [];
globalThis.fetch = () => { const task = deferred(); weatherRequests.push(task); return task.promise; };
globalThis.setInterval = callback => { refresh = callback; return 1; };
globalThis.clearInterval = () => {};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const row = { date: today, location: { location_id: 'Ds058', location_name: 'Kuala Lumpur' }, max_temp: 33, min_temp: 24, morning_forecast: 'Tiada Hujan', afternoon_forecast: 'Ribut petir', night_forecast: 'Hujan' };
try {
  const outlook = await mount(() => useWeatherForecast(), {});
  await act(async () => weatherRequests[0].resolve({ ok: true, json: async () => [row] }));
  check(outlook.model.status, 'ready'); check(outlook.model.days.length, 1);
  await act(async () => refresh());
  check(outlook.model.status, 'loading'); check(outlook.model.days.length, 1);
  await act(async () => weatherRequests[1].resolve({ ok: false }));
  check(outlook.model.status, 'error'); check(outlook.model.days.length, 0); check(outlook.model.retrievedAt, null);
  await outlook.close();
} finally {
  globalThis.fetch = savedFetch; globalThis.setInterval = savedInterval; globalThis.clearInterval = savedClearInterval;
}
delete globalThis.__uiAudit;
console.log(`UI lifecycle regression checks passed: ${checks}. Controlled fixtures, not live routing.`);
