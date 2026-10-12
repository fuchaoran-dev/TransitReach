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
    tsconfig: 'tsconfig.app.json',
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [{
      name: 'trip-planner-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: stubs[args.path],
          resolveDir: process.cwd(),
        }));
      },
    }],
  });
  const module = new Module(`${process.cwd()}/scripts/trip-planner-test-bundle.cjs`);
  module.filename = `${process.cwd()}/scripts/trip-planner-test-bundle.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}

let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

// The routing engine, replaced by a table of minutes between points. A missing pair is an
// answered request with no journey; `failures` makes the next requests fail outright.
const engine = { minutes: {}, calls: [], inFlight: 0, peak: 0, failures: 0, options: null };
globalThis.__tripPlannerEngine = engine;
const { planTrip } = await load('src/features/trip-planner/tripPlanService.ts', {
  '@/features/interchange/journeyInspectionService': `
    import { TransitJourneyUnavailableError } from './src/shared/services/transitRoutingClient';
    const engine = globalThis.__tripPlannerEngine;
    const journey = (ready, waitMinutes, rideMinutes) => ({
      id: 'journey-0', totalDurationSeconds: rideMinutes * 60,
      startTimeMs: ready + waitMinutes * 60000, endTimeMs: ready + (waitMinutes + rideMinutes) * 60000,
      walkTimeSeconds: 300, waitingTimeSeconds: 0, transitTimeSeconds: 0,
      legs: [], interchanges: [{ id: 'transfer' }], feasible: true, withinBudget: true,
    });
    export async function inspectJourneys(from, to, budget, time) {
      engine.calls.push({ pair: from.id + '>' + to.id, time });
      engine.peak = Math.max(engine.peak, ++engine.inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      engine.inFlight--;
      if (engine.failures > 0) { engine.failures--; throw new TransitJourneyUnavailableError('Could not reach the journey routing service.'); }
      const ready = Date.parse(time);
      const options = engine.options?.[from.id + '>' + to.id];
      if (options) return { journeys: options.map(([wait, ride]) => journey(ready, wait, ride)), rejectedJourneyCount: 0 };
      const minutes = engine.minutes[from.id + '>' + to.id];
      return { journeys: minutes === undefined ? [] : [journey(ready, 0, minutes)], rejectedJourneyCount: 0 };
    }`,
});
const { noPlanReasons } = await load('src/features/trip-planner/format.ts');

const stop = (id, hours, visitMinutes = 30) => ({
  service: { id, name: `Place ${id}`, category: 'clinic', lat: 3.1, lon: 101.6, pos: { x: 0, y: 0 }, hours },
  visitMinutes,
});
const origin = { id: 'origin', name: 'Home', lat: 3.0, lon: 101.5 };
const base = { origin, departureTime: '2026-10-10T09:00:00+08:00', final: null, limitMinutes: null };
const reset = minutes => Object.assign(engine, { minutes, calls: [], inFlight: 0, peak: 0, failures: 0, options: null });
const TWO = { 'origin>A': 10, 'origin>B': 30, 'A>B': 20, 'B>A': 20 };

for (const timezone of ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']) {
  process.env.TZ = timezone;

  // AC 2.2.1, 2.2.2 — each leg leaves at the previous arrival plus the visit.
  reset(TWO);
  let plan = await planTrip({ ...base, stops: [stop('B'), stop('A')] });
  check(plan.orders.map(order => order.id), ['A>B', 'B>A']);
  check(plan.orders[0].totals, { finishTime: '2026-10-10T02:30:00.000Z', elapsedSeconds: 5400, walkSeconds: 600, transfers: 2 });
  check(plan.orders[1].totals.elapsedSeconds, 6600);
  check(plan.orders[0].isUserOrder, false);
  check(plan.orders[1].isUserOrder, true);
  check(engine.calls.find(call => call.pair === 'A>B').time, '2026-10-10T01:40:00.000Z');
  check(plan.orders[0].visits.map(visit => [visit.arrivalTime, visit.departureTime]), [
    ['2026-10-10T01:10:00.000Z', '2026-10-10T01:40:00.000Z'],
    ['2026-10-10T02:00:00.000Z', '2026-10-10T02:30:00.000Z'],
  ]);
  check(plan.orders[0].legs.map(leg => leg.id), ['leg:origin>A', 'leg:A>B']);
  check([plan.ordersConsidered, plan.ordersCalculated, engine.calls.length], [2, 2, 4]);
  // AC 2.3.4 — no hours is Unknown, and Unknown does not rule an order out.
  check(plan.orders[0].visits[0].availability.status, 'Unknown');
  check(plan.orders[0].feasible, true);
  check(plan.orders[0].overLimitSeconds, null);

  // AC 2.2.3 — closed at the estimated arrival; the timeline still runs to its end.
  reset(TWO);
  plan = await planTrip({ ...base, stops: [stop('A', 'Mo-Su 09:00-10:00'), stop('B')] });
  const late = plan.orders.find(order => order.id === 'B>A');
  check(late.feasible, false);
  check(late.reasons, [{ kind: 'closed', stopId: 'A', stopName: 'Place A', arrivalTime: '2026-10-10T02:20:00.000Z' }]);
  check(late.totals.elapsedSeconds, 6600);
  check(plan.orders[0].id, 'A>B');
  check(plan.orders[0].visits[0].availability.status, 'Open');
  // Open on arrival at 09:10, closing at 10:00, with a 60-minute visit.
  plan = await planTrip({ ...base, stops: [stop('A', 'Mo-Su 09:00-10:00', 60), stop('B')] });
  check(plan.orders[0].visits[0].closesBeforeVisitEndsMinutes, 10);
  check(plan.orders[0].feasible, true);

  // AC 2.2.3 — an answered request with no journey is "no route", and ends the timeline.
  reset({ ...TWO, 'B>A': undefined });
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')] });
  const broken = plan.orders.find(order => order.id === 'B>A');
  check(broken.reasons, [{ kind: 'no-route', fromName: 'Place B', toName: 'Place A' }]);
  check([broken.feasible, broken.totals, broken.legs.length], [false, null, 1]);
  // AC 2.4.3 — no order works, and each says why.
  reset({ 'origin>A': 10, 'origin>B': 30 });
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')] });
  check(plan.orders.map(order => order.feasible), [false, false]);

  // AC 2.4.2 — the amount over the limit, not a within-budget label.
  reset(TWO);
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')], limitMinutes: 60 });
  check(plan.orders.map(order => order.overLimitSeconds), [1800, 3000]);
  check(plan.orders.map(order => order.feasible), [false, false]);
  check(plan.orders[0].reasons, [{
    kind: 'deadline', finishTime: '2026-10-10T02:30:00.000Z', deadlineTime: '2026-10-10T02:00:00.000Z',
  }]);
  check(noPlanReasons(plan), [
    'The earliest calculated finish is around 10:30 am, after your finish-by time. Leave earlier, shorten a visit or change the stops.',
  ]);
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')], limitMinutes: 90 });
  check(plan.orders[0].overLimitSeconds, 0);
  check(plan.orders[0].feasible, true);
  check(plan.orders[1].feasible, false);

  // AC 2.1.2 — a final destination adds a last leg, after the last visit.
  reset({ ...TWO, 'A>home': 15, 'B>home': 5 });
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')], final: { id: 'home', name: 'Home', lat: 3.0, lon: 101.5 } });
  check(plan.orders[0].legs.map(leg => leg.id), ['leg:origin>A', 'leg:A>B', 'leg:B>home']);
  check(plan.orders[0].totals.elapsedSeconds, 5700);
  check(plan.orders[0].legs[2].readyTime, '2026-10-10T02:30:00.000Z');

  // The journey that arrives first is used, not the shortest ride.
  reset(TWO);
  engine.options = { 'origin>A': [[40, 5], [0, 12]] };
  plan = await planTrip({ ...base, stops: [stop('A'), stop('B')] });
  check(plan.orders[0].visits[0].arrivalTime, '2026-10-10T01:12:00.000Z');
}

// AC 2.4.3 — what the result says about an outing nothing fits.
reset({ 'origin>A': 10, 'origin>B': 30, 'A>B': 20 });
const none = await planTrip({ ...base, stops: [stop('A'), stop('B', 'Mo-Su 06:00-08:00')] });
check(none.orders.some(order => order.feasible), false);
check(noPlanReasons(none), [
  'Place B is closed at its estimated arrival, between 9:30 am and 10:00 am. Its listed hours are Mo-Su 06:00-08:00.',
  'No journey was found from Place B to Place A at the time it would be travelled.',
]);

// Stop search — a kind of place lists the closest of that kind; the tag is finer than the category.
const { matchesKind, nearestFirst, straightLineMetres } = await load('src/features/trip-planner/stopSearch.ts', {
  '@/shared/data': "export const CATEGORY_META = { food: { label: 'Food & Meals' }, pharmacy: { label: 'Pharmacies' }, bank: { label: 'Banks & ATMs' } };",
});
const place = (id, category, sourceCategory, lat) => ({ id, name: `Place ${id}`, category, sourceCategory, lat, lon: 101.6 });
const cafe = place('cafe', 'food', 'amenity=cafe', 3.12);
const diner = place('diner', 'food', 'amenity=fast_food', 3.11);
const chemist = place('chemist', 'pharmacy', 'amenity=pharmacy', 3.2);
check([cafe, diner, chemist].map(item => matchesKind(item, 'cafe')), [true, false, false]);
check([cafe, diner, chemist].map(item => matchesKind(item, 'food')), [true, true, false]);
check([cafe, diner, chemist].map(item => matchesKind(item, 'fast food')), [false, true, false]);
check([matchesKind(chemist, 'pharmacies'), matchesKind(chemist, 'pharmacy'), matchesKind(chemist, 'ph')], [true, true, false]);
check(nearestFirst([chemist, cafe, diner], { lat: 3.1, lon: 101.6 }).map(item => item.id), ['diner', 'cafe', 'chemist']);
check(Math.round(straightLineMetres({ lat: 3.1, lon: 101.6 }, diner)), 1112);

// Five stops: 120 orders considered from 30 pair estimates, at most four calculated.
const ids = ['A', 'B', 'C', 'D', 'E'];
const five = {};
for (const [index, id] of ids.entries()) {
  five[`origin>${id}`] = 10 + index * 10;
  five[`${id}>home`] = 10 + index * 10;
  for (const [otherIndex, other] of ids.entries()) if (other !== id) five[`${id}>${other}`] = 10 * Math.abs(index - otherIndex);
}
reset(five);
const progress = [];
const userOrder = ['C', 'A', 'E', 'B', 'D'];
const big = await planTrip(
  { ...base, stops: userOrder.map(id => stop(id)), final: { id: 'home', name: 'Home', lat: 3.0, lon: 101.5 } },
  undefined,
  update => progress.push(update),
);
check([big.ordersConsidered, big.ordersCalculated], [120, 4]);
check(big.orders[0].id, 'A>B>C>D>E');
check(big.orders.filter(order => order.isUserOrder).map(order => order.id), ['C>A>E>B>D']);
check(engine.calls.length <= 30 + 4 * 6, true);
check(engine.peak <= 2, true);
check(progress.at(-1), { phase: 'calculating', done: 4, total: 4 });
check(progress.some(update => update.phase === 'estimating' && update.total === 30), true);

// One dropped connection is retried; an engine that stays down fails the plan outright.
reset(TWO);
engine.failures = 1;
check((await planTrip({ ...base, stops: [stop('A'), stop('B')] })).orders[0].feasible, true);
reset(TWO);
engine.failures = 100;
await assert.rejects(planTrip({ ...base, stops: [stop('A'), stop('B')] }), /Could not reach the journey routing service/);
checks++;
await assert.rejects(planTrip({ ...base, stops: [stop('A')] }), /2 to 5 stops/);
checks++;

// AC 2.1.3, 2.4.1 — the hook plans only when asked, ignores a superseded answer, and marks
// a shown plan out of date when the outing changes instead of recalculating it.
const pending = [];
globalThis.__tripPlannerHook = request => new Promise((resolve, reject) => pending.push({ request, resolve, reject }));
const { useTripPlan } = await load('src/features/trip-planner/hooks/useTripPlan.ts', {
  '../tripPlanService': 'export const planTrip = request => globalThis.__tripPlannerHook(request);',
});
const requestFor = (...stopIds) => ({ ...base, stops: stopIds.map(id => stop(id)) });
let model;
let view;
function Probe({ request }) { model = useTripPlan(request); return null; }
const first = requestFor('A', 'B');
await act(async () => { view = create(React.createElement(Probe, { request: first })); });
check([model.state.status, pending.length], ['idle', 0]);
await act(async () => model.plan());
check([model.state.status, pending.length], ['planning', 1]);
const second = requestFor('B', 'A');
await act(async () => view.update(React.createElement(Probe, { request: second })));
check(pending.length, 1);
await act(async () => model.plan());
check(pending.length, 2);
await act(async () => { pending[0].resolve({ request: first, orders: [] }); await pending[0].request; });
check(model.state.status, 'planning');
await act(async () => { pending[1].resolve({ request: second, orders: [] }); await pending[1].request; });
check([model.state.status, model.state.plan.request, model.state.version, model.outOfDate], ['ready', second, 1, false]);
await act(async () => view.update(React.createElement(Probe, { request: { ...second, stops: [stop('B', undefined, 60), stop('A')] } })));
check([model.state.status, model.outOfDate, pending.length], ['ready', true, 2]);
await act(async () => view.update(React.createElement(Probe, { request: null })));
check(model.outOfDate, true);
await act(async () => view.update(React.createElement(Probe, { request: second })));
check(model.outOfDate, false);
await act(async () => model.plan());
await act(async () => { pending[2].reject(new Error('Could not reach the journey routing service.')); await pending[2].request; });
check(model.state, { status: 'failed', message: 'Could not reach the journey routing service.' });
await act(async () => view.unmount());

delete globalThis.__tripPlannerHook;
delete globalThis.__tripPlannerEngine;
console.log(`Trip planner checks passed: ${checks}. Controlled fixtures, not live services.`);
