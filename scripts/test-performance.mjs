import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/performance-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/performance-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(result.outputFiles[0].text, module.filename);
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const { createSharedRequestCache } = await load('src/shared/data/sharedRequestCache.ts');

const cache = createSharedRequestCache(60_000, 2);
const task = deferred(); let calls = 0; let upstream;
const loader = signal => { calls++; upstream = signal; return task.promise; };
const a = new AbortController(), b = new AbortController();
const first = cache('same', loader, a.signal); const cancelled = assert.rejects(first, { name: 'AbortError' });
const second = cache('same', loader, b.signal);
await tick(); check(calls, 1);
a.abort(); await cancelled; check(upstream.aborted, false);
task.resolve(9); check(await second, 9); check(await cache('same', loader), 9); check(calls, 1);

const all = new AbortController(); const abandoned = deferred(); let abandonedSignal;
const abandonedResult = cache('abandoned', signal => { abandonedSignal = signal; return abandoned.promise; }, all.signal);
const abandonedError = assert.rejects(abandonedResult, { name: 'AbortError' });
await tick(); all.abort(); await abandonedError; check(abandonedSignal.aborted, true);
check(await cache('abandoned', async () => 11), 11);
abandoned.resolve(99); await tick(); check(await cache('abandoned', async () => 12), 11);
const preAborted = new AbortController(); preAborted.abort();
await assert.rejects(cache('same', loader, preAborted.signal), { name: 'AbortError' }); checks++;
await assert.rejects(cache('error', async () => { throw new Error('offline'); }));
check(await cache('error', async () => 7), 7);
const savedNow = Date.now;
let now = 0; Date.now = () => now;
try {
  const expiring = createSharedRequestCache(10, 2);
  check(await expiring('a', async () => 1), 1);
  now = 10; check(await expiring('a', async () => 2), 2);
  await expiring('b', async () => 3); await expiring('a', async () => 99); await expiring('c', async () => 4);
  check(await expiring('b', async () => 5), 5);
} finally { Date.now = savedNow; }

// Exercise the actual adapter, not just the helper. Two consumers still need exactly
// one transit + one walking-only request; a changed input cannot hit the old cache.
const routing = await load('src/shared/data/adapters/routingAdapter.ts', {
  './gtfsAdapter': 'export const loadRailFeedMetadata = () => ({ feeds: [] });',
});
const savedFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = (url, options) => {
  const task = deferred(); requests.push({ url, signal: options.signal, ...task }); return task.promise;
};
const origin = { lat: 3.07, lon: 101.6 };
const date = '2026-10-06T09:00:00+08:00';
const geometry = { type: 'Polygon', coordinates: [[[101.6, 3.07], [101.62, 3.07], [101.62, 3.09], [101.6, 3.07]]] };
const resolveCoverage = rows => rows.forEach(row => row.resolve({ ok: true, json: async () => ({ features: [{ geometry }] }) }));
try {
  const ca = new AbortController(), cb = new AbortController();
  const ra = routing.computeReachability(origin, 30, ca.signal, date);
  const rb = routing.computeReachability(origin, 30, cb.signal, date);
  await tick(); check(requests.length, 2);
  const rejected = assert.rejects(ra, { name: 'AbortError' }); ca.abort(); await rejected;
  check(requests.every(row => !row.signal.aborted), true);
  resolveCoverage(requests); const result = await rb;
  check((await routing.computeReachability(origin, 30, new AbortController().signal, date)).result.areaKm2, result.result.areaKm2);
  check(requests.length, 2);
  const different = routing.computeReachability(origin, 45, new AbortController().signal, date);
  await tick(); check(requests.length, 4); resolveCoverage(requests.slice(2)); await different;
  for (const [at, time, mode] of [
    [{ ...origin, lat: origin.lat + 0.000001 }, date, 'multimodal'],
    [origin, date.replace('09:00', '10:00'), 'multimodal'],
    [origin, date, 'walking'],
  ]) {
    const start = requests.length;
    const changed = routing.computeReachability(at, 30, new AbortController().signal, time, mode);
    await tick(); check(requests.length - start, mode === 'walking' ? 1 : 2);
    resolveCoverage(requests.slice(start)); await changed;
  }
  // Reset request counters only, not the adapter caches.
  requests.splice(4);
  const destination = { lat: 3.08, lon: 101.61 };
  const ea = routing.estimateTravelTime(origin, destination, 'multimodal', date);
  const eb = routing.estimateTravelTime(origin, destination, 'multimodal', date);
  await tick(); check(requests.length, 5);
  requests[4].resolve({ ok: true, json: async () => ({ plan: { itineraries: [{ duration: 540 }] } }) });
  check(await Promise.all([ea, eb]), [9, 9]);
  check(await routing.estimateTravelTime(origin, destination, 'multimodal', date), 9); check(requests.length, 5);
  const changed = routing.estimateTravelTime(origin, destination, 'multimodal', date.replace('09:00', '10:00'));
  await tick(); check(requests.length, 6);
  requests[5].resolve({ ok: false, status: 503 }); await assert.rejects(changed);
  const retry = routing.estimateTravelTime(origin, destination, 'multimodal', date.replace('09:00', '10:00'));
  await tick(); check(requests.length, 7); requests[6].resolve({ ok: true, json: async () => ({ plan: { itineraries: [] } }) });
  check(await retry, null);
} finally { globalThis.fetch = savedFetch; }

// Bootstrap initialization is single-flight, but an upstream error remains retryable.
const bootstrap = await load('src/shared/data/databaseData.ts');
let bootstrapCalls = 0; const boot = deferred();
globalThis.fetch = () => { bootstrapCalls++; return boot.promise; };
try {
  const left = bootstrap.initializeDatabaseData(), right = bootstrap.initializeDatabaseData();
  check(bootstrapCalls, 1); boot.resolve({ ok: false, status: 503 });
  await assert.rejects(left); await assert.rejects(right);
  globalThis.fetch = async () => { bootstrapCalls++; return { ok: true, json: async () => ({ railStops: [] }) }; };
  await bootstrap.initializeDatabaseData(); await bootstrap.initializeDatabaseData();
  check(bootstrapCalls, 2); check(bootstrap.databaseData().railStops, []);
} finally { globalThis.fetch = savedFetch; }
console.log(`Performance regression checks passed: ${checks}. Controlled fixtures, no cloud writes.`);
