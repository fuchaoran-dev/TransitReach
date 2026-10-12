import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], tsconfig: 'tsconfig.app.json', bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'planning-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/time-planning-test-bundle.cjs`);
  module.filename = `${process.cwd()}/scripts/time-planning-test-bundle.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const time = (clock, date = '2026-10-13') => `${date}T${clock}`;
const instant = clock => Date.parse(`${time(clock)}:00+08:00`);
const origin = { lat: 3.1, lon: 101.6 };
const services = [
  { id: 'lost', name: 'Old pharmacy', category: 'pharmacy', lat: 3.1, lon: 101.55, hours: '24/7', pos: { x: 0, y: 0 } },
  { id: 'gained', name: 'New pharmacy', category: 'pharmacy', lat: 3.1, lon: 101.95, hours: '24/7', pos: { x: 0, y: 0 } },
  { id: 'unknown', name: 'Unknown supermarket', category: 'market', lat: 3.1, lon: 101.7, pos: { x: 0, y: 0 } },
  { id: 'closed', name: 'Closed clinic', category: 'clinic', lat: 3.1, lon: 101.75, hours: 'Mo-Su 06:00-09:00', pos: { x: 0, y: 0 } },
];
const route = (departure, minutes = 30, walking = 5) => {
  const start = Date.parse(`${departure}:00+08:00`);
  return { durationSeconds: (minutes - 5) * 60, startTimeMs: start + 5 * 60_000, endTimeMs: start + minutes * 60_000,
    walkTimeSeconds: walking * 60, transfers: 1, legs: [{ mode: 'WALK', startTimeMs: start + 5 * 60_000, endTimeMs: start + (5 + walking) * 60_000 }],
  };
};
const regions = x => [{ outer: [[x, 3], [x + .4, 3], [x + .4, 3.3], [x, 3.3], [x, 3]], holes: [] }];
globalThis.__planning = { routes: (departure) => [route(departure)], region: departure => regions(departure.includes('18:00') ? 101.5 : 101.6) };
const planning = await load('src/features/time-planning/planningService.ts', {
  '@/shared/data/adapters/routingAdapter': `export const TRAVEL_MODE='multimodal'; export const computeReachability=async (origin,budget,signal,departure)=>({result:{regions:globalThis.__planning.region(departure),areaKm2:2}});`,
  '@/shared/services/transitRoutingClient': `export const routeJourneys=async (origin,service,departure)=>globalThis.__planning.routes(departure.slice(0,16),service);`,
});

const signal = new AbortController().signal;
const a = await planning.serviceSnapshot(origin, 45, time('18:00'), services, signal);
const b = await planning.serviceSnapshot(origin, 45, time('19:00'), services, signal);
check(planning.compareServices(a, b, 'reachable').map(row => [row.service.id, row.kind]), [['lost', 'lost'], ['gained', 'gained'], ['unknown', 'both'], ['closed', 'both']]);
const pharmacy = planning.compareServices(a, b, 'reachable').filter(row => row.service.category === 'pharmacy');
check(pharmacy.filter(row => row.kind === 'gained').length, 1);
check(pharmacy.filter(row => row.kind === 'lost').length, 1); // Net zero must show +1 and -1 separately.
check(b.entries.find(row => row.service.id === 'unknown').availability, 'unknown');
check(b.entries.find(row => row.service.id === 'closed').availability, 'unavailable');
check(planning.compareServices(a, b, 'available').find(row => row.service.id === 'unknown').kind, 'unknown');
const unknownAfter = { ...b, entries: b.entries.map(row => row.service.id === 'gained' ? { ...row, availability: 'unknown' } : row) };
check(planning.compareServices(a, unknownAfter, 'available').find(row => row.service.id === 'gained').kind, 'unknown');
check(planning.elapsedMinutes(route(time('19:00')), time('19:00')), 30); // includes initial waiting
check(planning.elapsedMinutes({ ...route(time('19:00')), startTimeMs: instant('18:59') }, time('19:00')), null);
check(planning.weatherCondition('Tiada hujan'), 'dry');
check(planning.weatherCondition('Ribut petir di beberapa tempat'), 'storm');
check(planning.weatherCondition('Berjerebu'), 'haze');
check(planning.weatherCondition('Something unsupported'), 'unknown');
const days = [{ date: '2026-10-13', morning: 'Tiada hujan', afternoon: 'Ribut petir', night: 'Tiada hujan', location: 'Kuala Lumpur' }];
const crossing = planning.walkingWeather({ legs: [{ mode: 'WALK', startTimeMs: instant('11:59') + 30_000, endTimeMs: instant('12:00') + 30_000 }] }, days);
check(crossing.weather, 'storm');
check(crossing.wetWalkingMinutes, .5);
check(planning.walkingWeather({ legs: [{ mode: 'WALK', startTimeMs: instant('23:59'), endTimeMs: instant('23:59') + 120_000 }] }, days).weatherComplete, false);
check(planning.departureCandidates(['2026-10-13'], '18:00', '20:00', instant('18:30')), [time('19:00'), time('20:00')]);
check(planning.departureCandidates(['2026-10-13'], '21:00', '18:00', 0), []);
check(planning.departureCandidates(['2026-10-13'], '18:80', '20:00', 0), []);
const option = (departure, overrides = {}) => ({ departure, availability: 'available', weather: 'dry', weatherComplete: true, wetWalkingMinutes: 0, travelMinutes: 35, walkMinutes: 8, transfers: 1, ...overrides });
const alternatives = [option(time('18:00'), { weather: 'storm', travelMinutes: 20, wetWalkingMinutes: 5 }), option(time('19:00')), option(time('20:00'), { weather: 'unknown', weatherComplete: false, travelMinutes: 15 })];
check(planning.rankDepartures(alternatives, 'avoid-rain')[0].departure, time('19:00'));
check(planning.rankDepartures(alternatives, 'fastest')[0].departure, time('20:00'));
check(planning.rankDepartures([option(time('19:00'), { availability: 'unknown' })], 'fastest'), []);
check(planning.rankDepartures([option(time('19:00'), { weatherComplete: false })], 'avoid-rain'), []);
globalThis.__planning.routes = departure => [route(departure, departure.includes('18:00') ? 20 : 35)];
const evening = await planning.evaluateDeparture(origin, services[1], time('19:00'), 45, days, 'avoid-rain', signal);
check(evening.availability, 'available');
check(evening.weather, 'dry');
const notOpen = await planning.evaluateDeparture(origin, services[3], time('19:00'), 45, days, 'fastest', signal);
check(notOpen.availability, 'unavailable');
const overBudget = await planning.evaluateDeparture(origin, services[1], time('19:00'), 15, days, 'fastest', signal);
check(overBudget.availability, 'unavailable');
globalThis.__planning.routes = () => { throw new Error('API failed'); };
check((await planning.evaluateDeparture(origin, services[1], time('19:00'), 45, days, 'fastest', signal)).availability, 'unknown');
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(planning.mapLimited([1], cancelled.signal, async value => value), /cancelled/); checks++;
let active = 0; let maximum = 0;
await planning.mapLimited([1, 2, 3, 4], signal, async () => { maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; });
check(maximum, 2);

// Rendered UI checks, with controlled API fixtures (not claims of live data).
globalThis.__planningUi = { a, b, deferred: null };
const { DeparturePlanningPanel } = await load('src/pages/components/DeparturePlanningPanel.tsx', {
  '@/shared/data': `export const CATEGORY_ORDER=['pharmacy','market','clinic']; export const CATEGORY_META={pharmacy:{label:'Pharmacies'},market:{label:'Supermarkets'},clinic:{label:'Clinics'}};`,
  '@/shared/data/adapters/essentialServicesAdapter': 'export const loadEssentialServices=()=>globalThis.__planningUi.a.entries.map(row=>row.service);',
  '@/features/essential-services': 'export const ServiceFilters=()=>null;',
  '@/features/time-planning/planningService': `export const matchesService=()=>true; export const departureCandidates=()=>[]; export const rankDepartures=()=>[]; export const mapLimited=async()=>[]; export const evaluateDeparture=async()=>null;
    export const serviceSnapshot=async(origin,budget,departure)=>globalThis.__planningUi.deferred ? globalThis.__planningUi.deferred : departure.includes('18:00') ? globalThis.__planningUi.a : globalThis.__planningUi.b;
    export const compareServices=(a,b,scope)=>a.entries.map(before=>{const after=b.entries.find(row=>row.service.id===before.service.id); return {service:before.service,before,after,current:after.reachable,kind:before.reachable===after.reachable?'both':after.reachable?'gained':'lost'};});`,
});
let view;
let applied = [];
const props = { origin, budget: 45, departure: time('18:00'), dates: ['2026-10-13'], weatherDays: days, weatherRetrievedAt: null,
  model: { categories: new Set(['pharmacy']), search: '', awaitingChoice: false, counts: {}, setSearch() {}, toggleCategory() {} }, onApply: value => applied.push(value), onBaseline() {}, onSelect() {},
};
await act(async () => { view = create(React.createElement(DeparturePlanningPanel, props)); });
await act(async () => { view.update(React.createElement(DeparturePlanningPanel, { ...props, departure: time('19:00') })); });
const compareButton = () => view.root.findAllByType('button').find(button => button.children.includes('Compare times'));
await act(async () => { await compareButton().props.onClick(); });
check(view.root.findAllByProps({ className: 'delta-badge delta-gained' })[0].children.join(''), '+1');
check(view.root.findAllByProps({ className: 'delta-badge delta-lost' })[0].children.join(''), '−1');
await act(async () => view.root.findAllByProps({ className: 'delta-badge delta-gained' })[0].props.onClick());
check(view.root.findAllByProps({ className: 'delta-details' }).length, 1);
check(JSON.stringify(view.toJSON()).includes('New pharmacy'), true);
await act(async () => { view.update(React.createElement(DeparturePlanningPanel, { ...props, departure: time('19:00'), budget: 30 })); });
check(view.root.findAllByProps({ className: 'service-delta-list' }).length, 0);
check(applied.length, 0); // comparison never silently changes the origin/date/budget
let resolve;
globalThis.__planningUi.deferred = new Promise(done => { resolve = done; });
await act(async () => compareButton().props.onClick());
check(view.root.findAllByProps({ className: 'planning-progress' }).length, 1);
await act(async () => view.root.findAllByType('button').find(button => button.children.includes('Cancel')).props.onClick());
await act(async () => { resolve(a); await globalThis.__planningUi.deferred; });
check(view.root.findAllByProps({ className: 'service-delta-list' }).length, 0);
await act(async () => view.unmount());

// Selection-driven recommendations: exercise the hook and compact card together.
globalThis.__autoPlanning = {
  calls: [], pending: [], hold: false, mode: 'available',
  candidates: planning.departureCandidates, rank: planning.rankDepartures, limited: planning.mapLimited,
};
const { useDepartureRecommendation } = await load('src/features/time-planning/useDepartureRecommendation.ts', {
  './planningService': `export const malaysiaInstant=t=>t+':00+08:00';
    export const departureCandidates=(...args)=>globalThis.__autoPlanning.candidates(...args);
    export const rankDepartures=(...args)=>globalThis.__autoPlanning.rank(...args);
    export const mapLimited=(...args)=>globalThis.__autoPlanning.limited(...args);
    export const evaluateDeparture=async(origin,service,time,budget,days,preference,signal)=>{
      const f=globalThis.__autoPlanning;
      f.calls.push({service:service.id,time,budget,days,preference,signal});
      if(f.hold) await new Promise(resolve=>f.pending.push(resolve));
      return {departure:time,availability:f.mode,reason:'Controlled route evidence',travelMinutes:25,walkMinutes:5,transfers:0,
        weather:days.length?'dry':'unknown',weatherComplete:!!days.length,weatherLabel:days.length?'No rain forecast':'Weather not checked',wetWalkingMinutes:0};
    };`,
});
const { ServiceDepartureRecommendation } = await load('src/pages/components/ServiceDepartureRecommendation.tsx');
const testNow = Date.parse('2026-10-11T09:00:00+08:00');
const autoProps = { origin, service: null, budget: 45, departure: time('13:00'),
  dates: ['2026-10-13', '2026-10-14', '2026-10-15'], weatherDays: days,
  weatherDistrictId: 'Ds058', weatherDistrictName: 'Kuala Lumpur', weatherRetrievedAt: null, enabled: true, now: testNow };
let model;
const Harness = props => {
  model = useDepartureRecommendation(props);
  return React.createElement(ServiceDepartureRecommendation, { model, onApply: value => applied.push(value) });
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 330)); });
const autoButton = label => view.root.findAllByType('button').find(button => button.children.includes(label));
await act(async () => { view = create(React.createElement(Harness, autoProps)); });
await settle();
check(globalThis.__autoPlanning.calls.length, 0);
check(model.blocked.startsWith('Select a service'), true);
check(view.root.findAllByType('details').every(details => !details.props.open), true);
check(JSON.stringify(view.toJSON()).includes('Destination for departure recommendation'), false);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1] })); });
await settle();
check(globalThis.__autoPlanning.calls.map(call => call.time), ['18:00', '19:00', '20:00', '21:00'].map(clock => time(clock)));
check(model.status, 'ready');
check(model.recommended.departure, time('18:00'));
check(model.routeOnly, true);
check(globalThis.__autoPlanning.calls.every(call => call.days.length === 0 && call.preference === 'less-walking'), true);
check(applied.length, 0);
await act(async () => autoButton('Use this time').props.onClick());
check(applied, [time('18:00')]);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, departure: time('18:00'), service: { ...services[1], estimatedTravelTime: 99 } })); });
await settle();
check(globalThis.__autoPlanning.calls.length, 4); // adopting same-day result / list estimates do not refetch
await act(async () => model.confirmWeather(true));
await settle();
check(model.weatherConfirmed, true);
check(model.effectivePreference, 'avoid-rain');
check(globalThis.__autoPlanning.calls.slice(-4).every(call => call.days.length === 1 && call.preference === 'avoid-rain'), true);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[2] })); });
check(model.weatherConfirmed, false);
check(model.recommended, undefined);
await settle();
check(globalThis.__autoPlanning.calls.length, 8); // missing hours: no unnecessary route requests
check(model.blocked.includes('Opening hours missing'), true);

globalThis.__autoPlanning.hold = true;
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[0] })); });
await settle();
check(model.status, 'checking');
const oldCalls = globalThis.__autoPlanning.calls.slice(-2);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1], budget: 30 })); });
check(oldCalls.every(call => call.signal.aborted), true);
await act(async () => { globalThis.__autoPlanning.pending.splice(0).forEach(resolve => resolve()); });
check(model.recommended, undefined); // late previous-destination results never appear
await settle();
await act(async () => model.cancel());
check(model.status, 'cancelled');
await act(async () => { globalThis.__autoPlanning.pending.splice(0).forEach(resolve => resolve()); });
await settle();
check(model.status, 'cancelled');
check(model.recommended, undefined);
globalThis.__autoPlanning.hold = false;
await act(async () => model.retry());
await settle();
check(model.status, 'ready');
await act(async () => model.setFromClock('19:00'));
await settle();
check(model.ranked.map(option => option.departure), ['19:00', '20:00', '21:00'].map(clock => time(clock)));
check(model.windowLabel.startsWith('Your window'), true);
globalThis.__autoPlanning.mode = 'unavailable';
await act(async () => model.retry());
await settle();
check(model.recommended, undefined);
check(Boolean(autoButton('View next seven days')), true);
check(globalThis.__autoPlanning.calls.every(call => call.time.startsWith('2026-10-13')), true); // never expand automatically
await act(async () => autoButton('View next seven days').props.onClick());
await settle();
check(model.toDate, '2026-10-15');
check(globalThis.__autoPlanning.calls.some(call => call.time.startsWith('2026-10-15')), true);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1], enabled: false })); });
check(model.status, 'idle');
check(model.recommended, undefined);
await act(async () => view.unmount());

// Defaults track the selected day; weather consent never survives a trip change.
globalThis.__autoPlanning.mode = 'available';
await act(async () => { view = create(React.createElement(Harness, { ...autoProps, service: services[1] })); });
await settle();
await act(async () => model.confirmWeather(true));
await settle();
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1], weatherDistrictId: 'Ds999' })); });
check(model.weatherConfirmed, false);
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1] })); });
check(model.weatherConfirmed, false);
await settle();
const previousModel = model;
await act(async () => model.cancel());
previousModel.apply(previousModel.recommended, value => applied.push(value));
check(applied.length, 1); // even a stale Apply handler cannot use cancelled results
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1], departure: '2026-10-14T13:00' })); });
await settle();
check(model.fromDate, '2026-10-14');
check(model.toDate, '2026-10-14');
check(model.ranked.every(option => option.departure.startsWith('2026-10-14')), true);
await act(async () => model.setFromClock('22:00'));
check(model.blocked, 'End of the window must follow its start.');
check(model.recommended, undefined);
await act(async () => model.resetWindow());
await settle();
await act(async () => { view.update(React.createElement(Harness, { ...autoProps, service: services[1], now: Date.parse('2026-10-13T21:30:00+08:00') })); });
check(model.blocked.startsWith('No future departures'), true);
check(model.recommended, undefined);
await act(async () => view.unmount());
delete globalThis.__autoPlanning;
delete globalThis.__planning;
delete globalThis.__planningUi;
console.log(`Time-planning domain and UI checks passed: ${checks}. Controlled fixtures, not live services.`);
