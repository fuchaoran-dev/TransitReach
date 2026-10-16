import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], tsconfig: 'tsconfig.app.json', define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'pagination-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/pagination-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/pagination-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const json = value => new Response(JSON.stringify(value));
const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-only' } } }) } };
const first = { status: 'ready', areaMethod: 'budget-window-preview', roomRevision: 7, budgetMinutes: 60,
  participantCount: 2, missingStartingPoints: 0, arrivalTime: '2026-10-20T18:30:00+08:00',
  participantAreas: [{ regions: [] }, { regions: [] }], proposals: [], searchPage: 0, hasMore: true, checkedPlaces: 24 };
const second = { ...first, searchPage: 1, hasMore: false, checkedPlaces: 48 };
const service = await load('src/features/meeting-point/commonGroundService.ts');
const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const timers = new Map(); let next = 0;
globalThis.setTimeout = (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
try {
  let calls = 0; const requests = []; const progress = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body)); calls++;
    return json(calls === 1 ? { status: 'computing', result: first } : { status: 'ready', result: second });
  };
  const task = service.fetchCommonGround(client, 'ABCDEFGH', 60, ['mall'], new AbortController().signal, 7, r => progress.push(r), 1);
  await tick();
  check(progress, [first]);
  const pause = [...timers].find(([, timer]) => timer.delay === 2000);
  assert.ok(pause); checks++;
  timers.delete(pause[0]); pause[1].callback(); await tick();
  check(await task, second);
  check(requests, Array.from({ length: 2 }, () => ({ timeBudget: 60, roomRevision: 7, venueTypes: ['mall'], page: 1 })));
  check(timers.size, 0);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 410 }); };
  await assert.rejects(service.fetchCommonGround(client, 'ABCDEFGH', 60, ['mall'], new AbortController().signal, 7, undefined, 1), service.MeetingSearchExpiredError); checks++;
  check(calls, 1); check(timers.size, 0);
  globalThis.fetch = async () => json({ status: 'ready', result: first });
  await assert.rejects(service.fetchCommonGround(client, 'ABCDEFGH', 60, ['mall'], new AbortController().signal, 7, undefined, 1), /incomplete search batch/); checks++;
  for (const invalid of [{ searchPage: -1 }, { searchPage: 20 }, { hasMore: 'yes' }, { checkedPlaces: -1 }]) {
    globalThis.fetch = async () => json({ status: 'ready', result: { ...first, ...invalid } });
    await assert.rejects(service.fetchCommonGround(client, 'ABCDEFGH', 60, ['mall'], new AbortController().signal, 7), /incompatible/); checks++;
  }
  check(timers.size, 0);
} finally { Object.assign(globalThis, original); }

class Expired extends Error {}
globalThis.__paged = { requests: [], Expired };
const { useServerCommonGround } = await load('src/features/meeting-point/hooks/useServerCommonGround.ts', {
  '../supabaseClient': 'export const supabase = {};',
  '../commonGroundService': `export const MeetingSearchExpiredError = globalThis.__paged.Expired;
    export const fetchCommonGround = (_client, code, budget, types, signal, revision, progress, page) => new Promise((resolve,reject)=>{
      globalThis.__paged.requests.push({code,budget,types,signal,revision,progress,page,resolve,reject});
    });`,
});
let model;
const allTypes = new Set(['station', 'cafe', 'restaurant', 'mall']);
function Probe({ revision = '7', budget = 60, types = allTypes }) {
  model = useServerCommonGround('ABCDEFGH', budget, types, revision);
  return null;
}
let tree;
const requests = globalThis.__paged.requests;
const oldError = console.error;
try {
  await act(async () => { tree = create(React.createElement(Probe)); });
  check(requests[0].page, 0);
  await act(async () => { requests[0].resolve(first); });
  check(model.state.status, 'ready');
  await act(async () => { model.loadMore(); model.loadMore(); });
  check(requests.length, 2); check(requests[1].page, 1);
  check(model.loadingMore, true); check(model.state.result, first);
  console.error = () => {};
  await act(async () => { requests[1].reject(new Expired('Search expired')); });
  check(model.state.restartRequired, true); check(model.state.result, first);
  await act(async () => { model.restart(); });
  check(requests[2].page, 0); check(model.state.result, first);
  await act(async () => { requests[2].resolve(first); });
  await act(async () => { model.loadMore(); });
  check(requests[3].page, 1);
  await act(async () => { tree.update(React.createElement(Probe, { revision: '8' })); });
  check(requests[3].signal.aborted, true); check(requests[4].page, 0);
  check(model.state.result, undefined);
  await act(async () => { requests[3].resolve(second); });
  check(model.state.result, undefined);
  const current = { ...first, roomRevision: 8 };
  await act(async () => { requests[4].resolve(current); });
  await act(async () => { tree.update(React.createElement(Probe, { revision: '8', types: new Set(['mall']) })); });
  check(requests[5].types, ['mall']); check(requests[5].page, 0);
  check(model.state.result, current); // Same-room geometry/list survives a category search.
  await act(async () => { requests[5].resolve({ ...current, hasMore: false }); });
  await act(async () => { model.loadMore(); });
  check(requests.length, 6);
  await act(async () => { tree.update(React.createElement(Probe, { revision: '8', budget: 30 })); });
  check(requests[6].page, 0); check(model.state.result, undefined);
  await act(async () => { tree.unmount(); });
  check(requests[6].signal.aborted, true);
  requests.length = 0;
  await act(async () => { tree = create(React.createElement(Probe)); });
  await act(async () => { requests[0].resolve(first); });
  await act(async () => { model.loadMore(new Set(['mall'])); });
  check(requests[1].types, ['mall']); check(requests[1].page, 0);
  check(model.searchTypesKey, 'mall'); check(model.state.result, first);
  await act(async () => { requests[1].resolve(first); });
  await act(async () => { model.loadMore(new Set(['mall'])); });
  check(requests[2].page, 1); check(requests[2].types, ['mall']);
  await act(async () => { tree.unmount(); });
} finally {
  console.error = oldError;
  delete globalThis.__paged;
}
console.log(`Meeting pagination checks passed: ${checks}. Controlled requests/state; no cloud writes.`);
