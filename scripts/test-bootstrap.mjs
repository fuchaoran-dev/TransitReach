import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], tsconfig: 'tsconfig.app.json', define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'controlled-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/bootstrap-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/bootstrap-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const rejected = (promise, pattern) => { checks++; return assert.rejects(promise, pattern); };
const payload = { railStops: [], busStops: [], places: [], essentialServices: [], railPatterns: [], railShapes: {}, railMetadata: {}, placesMetadata: {}, servicesMetadata: {} };
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const { loadDatabaseBootstrap, BootstrapLoadError } = await load('src/shared/data/bootstrapLoader.ts');

// Virtual clocks exercise the two-minute ceiling without wall-clock waits or live APIs.
async function clockTest(run) {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
  const timers = new Map(); let now = 0; let next = 0;
  Date.now = () => now;
  globalThis.setTimeout = (callback, delay = 0) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = async milliseconds => {
    const target = now + milliseconds;
    for (;;) {
      const item = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!item) break;
      now = item[1].at; timers.delete(item[0]); item[1].callback(); await tick();
    }
    now = target; await tick();
  };
  try { await run({ advance, timers }); check(timers.size, 0); }
  finally { Object.assign(globalThis, { fetch: original.fetch, setTimeout: original.setTimeout, clearTimeout: original.clearTimeout }); Date.now = original.now; }
}

await clockTest(async ({ advance }) => {
  const requests = []; const progress = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1 ? new Response(null, { status: 504 })
      : requests.length === 2 ? new Response(null, { status: 503, headers: { 'Retry-After': '20' } }) : response(payload);
  };
  const task = loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal, value => progress.push(value));
  await tick(); check(requests.length, 1); await advance(5000); check(requests.length, 2);
  await advance(19999); check(requests.length, 2); await advance(1);
  check(await task, payload); check(requests.length, 3);
  check(requests.every(item => item.url === '/api/data/bootstrap' && !item.options.cache && !item.options.headers), true);
  check(progress.map(value => [value.attempt, value.phase]), [[1, 'requesting'], [1, 'retrying'], [2, 'requesting'], [2, 'retrying'], [3, 'requesting']]);
});

for (const status of [408, 429, 500, 502, 503, 504]) await clockTest(async ({ advance }) => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(null, { status }); };
  const failure = rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), new RegExp(`HTTP ${status}`));
  await tick(); await advance(65_000); await failure; check(requests, 4);
});
for (const status of [400, 401, 403, 404]) await clockTest(async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(null, { status }); };
  await rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), new RegExp(`HTTP ${status}`));
  check(requests, 1);
});

await clockTest(async ({ advance }) => {
  const signals = [];
  globalThis.fetch = async (_, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) throw new TypeError('private network diagnostic');
    if (signals.length === 2) return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) };
    return response(payload);
  };
  const task = loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal);
  await tick(); await advance(5000); await advance(32_000);
  check(signals[1].aborted, true); await advance(15_000); check(await task, payload); check(signals.length, 3);
});

await clockTest(async ({ advance }) => {
  const signals = [];
  globalThis.fetch = (_, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) return Promise.resolve(new Response(null, { status: 503, headers: { 'Retry-After': '100' } }));
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const failure = rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), /within two minutes/);
  await tick(); await advance(120_000); await failure;
  check(signals.length, 2); check(signals[1].aborted, true);
});

await clockTest(async ({ advance }) => {
  let requests = 0; const controller = new AbortController();
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 504 }); };
  const failure = rejected(loadDatabaseBootstrap('/api/data/bootstrap', controller.signal), { name: 'AbortError' });
  await tick(); controller.abort(); await failure; await advance(10_000); check(requests, 1);
});
await clockTest(async () => {
  globalThis.fetch = () => { throw new Error('No request should run'); };
  const controller = new AbortController(); controller.abort();
  await rejected(loadDatabaseBootstrap('/api/data/bootstrap', controller.signal), { name: 'AbortError' });
});
for (const value of [{}, { ...payload, essentialServices: null }, { ...payload, railShapes: [] }]) await clockTest(async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return response(value); };
  await rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), /incompatible dataset/);
  check(requests, 1);
});
await clockTest(async () => {
  globalThis.fetch = async () => new Response('<html>Gateway unavailable</html>');
  await rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), /unreadable response/);
});
await clockTest(async ({ advance }) => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 503, headers: { 'Retry-After': new Date(10_000).toUTCString() } }) : response(payload);
  const task = loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal);
  await tick(); await advance(9999); check(calls, 1); await advance(1); check(await task, payload);
});
await clockTest(async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '300' } }); };
  await rejected(loadDatabaseBootstrap('/api/data/bootstrap', new AbortController().signal), /HTTP 429/); check(calls, 1);
});

const shared = await load('src/shared/data/databaseData.ts');
await clockTest(async () => {
  const task = deferred(); let calls = 0; let signal;
  globalThis.fetch = (_, options) => { calls++; signal = options.signal; return task.promise; };
  const a = new AbortController(), b = new AbortController();
  const first = shared.initializeDatabaseData(a.signal), second = shared.initializeDatabaseData(b.signal);
  const cancelled = rejected(first, { name: 'AbortError' });
  await tick(); check(calls, 1); a.abort(); await cancelled; check(signal.aborted, false);
  task.resolve(response(payload)); await second; check(shared.databaseData(), payload);
  await shared.initializeDatabaseData(); check(calls, 1);
});
const stale = await load('src/shared/data/databaseData.ts');
await clockTest(async () => {
  const old = deferred(); let calls = 0; let signal;
  globalThis.fetch = (_, options) => { calls++; if (calls === 1) { signal = options.signal; return old.promise; } return Promise.resolve(response(payload)); };
  const controller = new AbortController();
  const cancelled = rejected(stale.initializeDatabaseData(controller.signal), { name: 'AbortError' });
  await tick(); controller.abort(); await cancelled; check(signal.aborted, true);
  await stale.initializeDatabaseData(); old.resolve(response({ ...payload, railStops: ['stale fixture'] }));
  await tick(); check(stale.databaseData().railStops, []); check(calls, 2);
});

globalThis.__bootstrapAudit = { BootstrapLoadError, tasks: [], listeners: new Set() };
const audit = globalThis.__bootstrapAudit;
audit.load = signal => { const task = { ...deferred(), signal }; audit.tasks.push(task); return task.promise; };
const { useApplicationStartup } = await load('src/app/hooks/useApplicationStartup.ts', {
  '../bootstrapService': 'export const loadApplication = globalThis.__bootstrapAudit.load;',
  '@/shared/data/bootstrapLoader': 'export const BootstrapLoadError = globalThis.__bootstrapAudit.BootstrapLoadError;',
  '@/shared/data/databaseData': 'export const subscribeDatabaseProgress = listener => { globalThis.__bootstrapAudit.listeners.add(listener); return () => globalThis.__bootstrapAudit.listeners.delete(listener); };',
});
await clockTest(async ({ advance }) => {
  let model; let view;
  function Probe() { model = useApplicationStartup(); return null; }
  await act(async () => { view = create(React.createElement(Probe)); });
  check(model.state.status, 'loading'); await act(async () => advance(8000)); check(model.state.slow, true);
  await act(async () => audit.tasks[0].reject(new BootstrapLoadError('City data request failed (HTTP 504).')));
  check(model.state.status, 'failed'); check(model.state.message.includes('504'), true);
  await act(async () => model.retry()); check(model.state.status, 'loading'); check(audit.tasks.length, 2);
  check(audit.tasks[0].signal.aborted, true);
  const Application = () => React.createElement('p', null, 'Fixture ready');
  await act(async () => audit.tasks[1].resolve(Application)); check(model.state.status, 'ready');
  check(model.state.Application, Application); await act(async () => model.retry()); check(audit.tasks.length, 2);
  await act(async () => view.unmount()); check(audit.listeners.size, 0);
  await act(async () => { view = create(React.createElement(Probe)); });
  await act(async () => view.unmount()); check(audit.tasks[2].signal.aborted, true);
  await act(async () => audit.tasks[2].resolve(Application)); check(model.state.status, 'loading');
});
delete globalThis.__bootstrapAudit;

const { StartupScreen } = await load('src/app/StartupScreen.tsx');
for (const [state, expected] of [
  [{ status: 'loading', progress: null, slow: false }, 'Loading your city explorer'],
  [{ status: 'loading', progress: { attempt: 2, maxAttempts: 4, phase: 'retrying' }, slow: true }, 'server may be waking up'],
  [{ status: 'failed', message: 'City data request failed (HTTP 504).' }, 'Retry connection'],
]) {
  const markup = renderToStaticMarkup(React.createElement(StartupScreen, { state, onRetry: () => {} }));
  check(markup.includes(expected), true); check(markup.includes(state.status === 'failed' ? 'role="alert"' : 'role="status"'), true);
}
let retries = 0; let screen;
await act(async () => { screen = create(React.createElement(StartupScreen, { state: { status: 'failed', message: 'HTTP 504' }, onRetry: () => retries++ })); });
await act(async () => screen.root.findByType('button').props.onClick()); check(retries, 1);
await act(async () => screen.unmount());

// Actual gate + startup service + shared initializer + loader: recovery mounts the
// app in this same React root, without calling location.reload or replacing URLs.
const appStub = { './App': 'import React from "react"; export default function App() { return React.createElement("p", { id: "fixture-ready" }, "Fixture city loaded"); }' };
for (const automatic of [true, false]) {
  const { ApplicationBootstrap } = await load('src/app/ApplicationBootstrap.tsx', appStub);
  await clockTest(async ({ advance }) => {
    let calls = 0; let view;
    globalThis.fetch = async () => ++calls === 1
      ? new Response(null, { status: automatic ? 504 : 401 }) : response(payload);
    await act(async () => { view = create(React.createElement(ApplicationBootstrap)); });
    check(calls, 1); check(view.root.findAllByProps({ id: 'fixture-ready' }).length, 0);
    if (automatic) {
      check(view.root.findAllByType('button').length, 0);
      await act(async () => advance(5000));
    } else {
      check(view.root.findAllByProps({ role: 'alert' }).length, 1);
      await act(async () => view.root.findByType('button').props.onClick());
    }
    check(calls, 2); check(view.root.findByProps({ id: 'fixture-ready' }).children, ['Fixture city loaded']);
    await act(async () => view.unmount());
  });
}
console.log(`Bootstrap recovery checks passed: ${checks}. Virtual clocks/synthetic data; no cloud writes or local JSON fallback.`);
