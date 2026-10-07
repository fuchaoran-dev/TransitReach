import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');

async function load(entry, stubs = {}) {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react'],
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [{
      name: 'outing-pass-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
      },
    }],
  });
  const module = new Module(`${process.cwd()}/scripts/outing-pass-test-bundle.cjs`);
  module.filename = `${process.cwd()}/scripts/outing-pass-test-bundle.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}

let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const at = value => Date.parse(`2026-10-07T${value}:00+08:00`);
const point = name => ({ name, stopId: name, lat: 3.1, lon: 101.6 });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const leg = (mode, route, from, to, start, end) => ({
  mode,
  routeId: route,
  routeShortName: route,
  routeLongName: null,
  routeColor: null,
  durationSeconds: (at(end) - at(start)) / 1000,
  distanceMeters: mode === 'WALK' ? 400 : 5_000,
  startTimeMs: at(start),
  endTimeMs: at(end),
  from: point(from),
  to: point(to),
  geometry: [],
  transitLeg: mode !== 'WALK',
  steps: mode === 'WALK' ? [{ relativeDirection: 'CONTINUE', streetName: 'Jalan Test', bogusName: false, distanceMeters: 400, lat: 3.1, lon: 101.6 }] : [],
});
const itinerary = {
  durationSeconds: 50 * 60,
  startTimeMs: at('10:00'),
  endTimeMs: at('10:50'),
  walkTimeSeconds: 7 * 60,
  waitingTimeSeconds: 3 * 60,
  transitTimeSeconds: 40 * 60,
  transfers: 1,
  legs: [
    leg('BUS', 'B1', 'S1', 'S2', '10:00', '10:20'),
    leg('WALK', null, 'S2', 'S3', '10:20', '10:27'),
    leg('SUBWAY', 'KJ', 'S3', 'Venue', '10:30', '10:50'),
  ],
};

globalThis.__outingPassFixture = { itinerary, unsupported: false };
const { checkPersonalPlan, evaluateClosingMargin } = await load('src/features/outing-pass/passCheckService.ts', {
  '@/shared/services/transitRoutingClient': 'export const routeArriveByJourneys = async () => [globalThis.__outingPassFixture.itinerary];',
  './reliabilityClient': `export const fetchBusDelay = async route => globalThis.__outingPassFixture.unsupported && route === 'B1'
    ? { status: 'not-checked', reason: 'model-not-available', label: 'Not checked' }
    : { status: 'checked', seconds: 240, confidence: 'high', sampleCount: 40, source: 'fixture', modelVersion: 'v1', disclaimer: 'estimate' };`,
  './weatherService': "export const weatherDistrictForVenue = () => ({ id: 'Ds058', name: 'Kuala Lumpur' }); export const fetchOfficialForecast = async district => ({ district, rows: [], retrievedAt: new Date().toISOString() }); export const walkingWeatherFromForecast = () => [{ status: 'checked', period: 'Morning', summary: 'No rain', source: 'MET Malaysia via data.gov.my', sourceUrl: '', location: 'Kuala Lumpur', retrievedAt: new Date().toISOString(), walkingSecondsInPeriod: 420 }];",
});
const input = {
  roomCode: 'ABCD2345',
  memberId: 'member-a',
  origin: { lat: 3.1, lon: 101.6 },
  plan: {
    venue: { id: 'venue', type: 'cafe', name: 'Fixture Cafe', kindLabel: 'Cafe', lat: 3.2, lon: 101.7, hours: 'Mo-Su 00:00-23:59' },
    arrivalTime: '2026-10-07T11:00:00+08:00',
    version: 2,
  },
};
check(evaluateClosingMargin('24/7', '2026-10-07T12:00:00+08:00').status, 'always-open');
check(evaluateClosingMargin('24/7', '2026-10-07T12:00:00+08:00').label, 'Open 24 hours');
const overnightOpen = evaluateClosingMargin('Mo-Su 22:00-02:00', '2026-10-07T01:00:00+08:00');
check(overnightOpen.status, 'checked');
check(overnightOpen.marginSeconds, 3_600);
const overnightClosed = evaluateClosingMargin('Mo-Su 22:00-02:00', '2026-10-07T03:00:00+08:00');
check(overnightClosed.status, 'checked');
check(overnightClosed.marginSeconds, -3_600);
const checked = await checkPersonalPlan(input);
const pass = checked.passes[0];
check(pass.legs[0].estimatedEndTime, '2026-10-07T02:24:00.000Z');
check(pass.legs[2].estimatedStartTime, '2026-10-07T02:30:00.000Z');
check(pass.legs[2].estimatedEndTime, '2026-10-07T02:54:00.000Z');
check(pass.arrivalMarginSeconds, 360);
check(pass.connections[0].spareSeconds, -60);
check(pass.status, 'Check needed');
check(pass.weather[0].walkingSecondsInPeriod, 420);

globalThis.__outingPassFixture.unsupported = true;
const unsupported = (await checkPersonalPlan(input)).passes[0];
check(unsupported.legs[0].delay.status, 'not-checked');
check(unsupported.status, 'Not checked');
check(unsupported.weakPoint.kind, 'unchecked-delay');

globalThis.__outingPassFixture.itinerary = {
  ...itinerary,
  legs: itinerary.legs.map((value, index) => index === 0 ? { ...value, from: { ...value.from, lat: 0 } } : value),
};
await assert.rejects(checkPersonalPlan(input), /No arrive-by journey/);
checks++;
globalThis.__outingPassFixture.itinerary = itinerary;

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const storage = await load('src/features/outing-pass/passStorage.ts');
storage.savePersonalPass(pass);
check(storage.loadStoredPass('ABCD2345', 'member-a', 2)?.memberId, 'member-a');
check(storage.loadStoredPass('ABCD2345', 'member-b', 2), null);
check(storage.loadStoredPass('ABCD2345', 'member-a', 3), null);
check(storage.listStoredPasses('member-a', { ABCD2345: 3 }, Date.parse('2026-10-07T00:00:00Z'))[0].outdated, true);

const { createRoomQrData } = await load('src/features/outing-pass/passExport.ts');
const qrPayload = createRoomQrData('ABCD2345', 'https://example.com/app?member=secret#private');
check(qrPayload, 'https://example.com/app?meet=ABCD2345');
check(qrPayload.includes('member'), false);

const requested = [];
const savedFetch = globalThis.fetch;
const savedLog = console.log;
const savedError = console.error;
globalThis.fetch = async url => {
  requested.push(new URL(url, 'https://routing.test'));
  return { ok: true, json: async () => ({ plan: { itineraries: [] } }) };
};
console.log = () => {};
console.error = () => {};
try {
  const routing = await load('src/shared/services/transitRoutingClient.ts');
  await routing.routeArriveByJourneys({ lat: 3.1, lon: 101.6 }, { lat: 3.2, lon: 101.7 }, '2026-10-07T03:00:00Z');
  check(requested.every(url => url.searchParams.get('arriveBy') === 'true'), true);
  check(requested.every(url => url.searchParams.get('date') === '2026-10-07'), true);
  check(requested.every(url => url.searchParams.get('time') === '11:00:00'), true);
} finally {
  globalThis.fetch = savedFetch;
  console.log = savedLog;
  console.error = savedError;
}

let reliabilityUrl;
globalThis.fetch = async url => {
  reliabilityUrl = new URL(url, 'https://api.test');
  return { ok: true, json: async () => ({ supported: false, reason: 'model_not_available' }) };
};
try {
  const reliability = await load('src/features/outing-pass/reliabilityClient.ts');
  await reliability.fetchBusDelay('agency:B1', 'agency:S1', '2026-10-07T02:00:00Z');
  check(reliabilityUrl.searchParams.get('line_id'), 'B1');
  check(reliabilityUrl.searchParams.get('stop_id'), 'S1');
  check(reliabilityUrl.searchParams.get('datetime'), '2026-10-07T10:00:00+08:00');
} finally {
  globalThis.fetch = savedFetch;
}

let weatherFetches = 0;
globalThis.fetch = async () => {
  weatherFetches++;
  return {
    ok: true,
    json: async () => [{
      date: '2026-10-07',
      location: { location_id: 'Ds058', location_name: 'Kuala Lumpur' },
      morning_forecast: 'No rain',
      afternoon_forecast: 'Rain',
      night_forecast: 'No rain',
    }],
  };
};
try {
  const weather = await load('src/features/outing-pass/weatherService.ts');
  check(weather.weatherDistrictForVenue({ address: 'Jalan Kiara, Kuala Lumpur, 50480' }), { id: 'Ds058', name: 'Kuala Lumpur' });
  check(weather.weatherDistrictForVenue({ address: 'Bandar Sunway, Petaling Jaya, 47500' }), null);
  const exposure = await weather.fetchWalkingWeather('2026-10-07T12:00:00+08:00', [{
    mode: 'WALK', durationSeconds: 60,
    estimatedStartTime: '2026-10-07T11:59:30+08:00',
    estimatedEndTime: '2026-10-07T12:00:30+08:00',
  }], { id: 'Ds058', name: 'Kuala Lumpur' });
  check(exposure.map(item => [item.period, item.walkingSecondsInPeriod]), [['Morning', 30], ['Afternoon', 30]]);
  const unknownDistrict = await weather.fetchWalkingWeather('2026-10-07T12:00:00+08:00', [], null);
  check(unknownDistrict[0].status, 'not-checked');
  check(weatherFetches, 1);
} finally {
  globalThis.fetch = savedFetch;
}

const hookRequests = [];
globalThis.__outingPassHook = {
  check: () => {
    const request = deferred();
    hookRequests.push(request);
    return request.promise;
  },
  saves: 0,
};
const { usePersonalPass } = await load('src/features/outing-pass/hooks/usePersonalPass.ts', {
  '../passCheckService': `export const checkPersonalPlan = (...args) => globalThis.__outingPassHook.check(...args);
    export const earlierRouteTarget = value => value;`,
  '../passStorage': `export const loadStoredPass = () => null;
    export const savePersonalPass = () => { globalThis.__outingPassHook.saves++; };`,
});
const passOption = (id, memberId = 'member-a') => ({
  id: 'ABCD2345-v2', roomCode: 'ABCD2345', memberId, planVersion: 2,
  selectedJourneyId: id, status: 'Ready', leaveTime: '2026-10-07T02:00:00Z',
  estimatedArrivalTime: '2026-10-07T02:50:00Z',
});
const result = label => ({
  passes: [passOption('journey-0'), { ...passOption('journey-1'), label }],
  summaries: [
    { id: 'journey-0', selected: true },
    { id: 'journey-1', selected: false },
  ],
});
let hookModel;
let hookView;
function HookProbe(props) { hookModel = usePersonalPass(props); return null; }
const hookProps = { roomCode: 'ABCD2345', memberId: 'member-a', plan: input.plan, origin: { at: input.origin, source: 'map', label: null } };
await act(async () => { hookView = create(React.createElement(HookProbe, hookProps)); });
check(hookRequests.length, 1);
await act(async () => hookView.update(React.createElement(HookProbe, { ...hookProps, origin: { ...hookProps.origin, at: { lat: 3.11, lon: 101.61 } } })));
check(hookRequests.length, 2);
await act(async () => { hookRequests[0].resolve(result('stale')); await hookRequests[0].promise; });
check(hookModel.state.status, 'checking');
await act(async () => { hookRequests[1].resolve(result('fresh')); await hookRequests[1].promise; });
check(hookModel.state.status, 'ready');
await act(async () => hookModel.selectJourney('journey-1'));
check(hookRequests.length, 3);
check(hookModel.state.status, 'checking');
await act(async () => { hookRequests[2].resolve(result('rechecked')); await hookRequests[2].promise; });
check(hookModel.state.pass.selectedJourneyId, 'journey-1');
check(globalThis.__outingPassHook.saves, 2);
await act(async () => hookView.unmount());

delete globalThis.__outingPassFixture;
delete globalThis.__outingPassHook;
console.log(`Outing pass domain checks passed: ${checks}. Controlled fixtures, not live services.`);
