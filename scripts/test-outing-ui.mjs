import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const Module = require('node:module');
globalThis.__outingUiFixture = { published: [], state: { status: 'idle', reason: 'missing-origin' } };
async function load(entry, stubs = {}) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
    plugins: [{ name: 'private-pass-ui-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = new Module(`${process.cwd()}/scripts/outing-ui-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/outing-ui-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const { GroupStatus } = await load('src/features/outing-pass/components/GroupStatus.tsx');
let view;
await act(async () => { view = create(React.createElement(GroupStatus, { members: [{ id: 'opaque', displayName: 'Other member', arrivalStatus: 'Not checked', isSelf: false, origin: { lat: 12.345678, lon: 34.56789 }, route: 'PRIVATE_OTHER_ROUTE' }] })); });
const rendered = JSON.stringify(view.toJSON());
check(rendered.includes('Other member'), true);
check(rendered.includes('Not checked'), true);
check(rendered.includes('PRIVATE_OTHER_ROUTE'), false);
check(rendered.includes('12.345678'), false);
await act(async () => view.unmount());

const { InvitationCard } = await load('src/features/outing-pass/components/InvitationCard.tsx');
await act(async () => { view = create(React.createElement(InvitationCard, { room: { confirmedPlan: null } })); });
check(view.toJSON(), null);
await act(async () => view.unmount());

const { GroupOutingView } = await load('src/features/outing-pass/components/GroupOutingView.tsx', {
  '../hooks/usePersonalPass': 'export const usePersonalPass = () => ({state:globalThis.__outingUiFixture.state,recheck(){},selectJourney(){},leaveEarlier(){}});',
  '../passStorage': 'export const loadStoredPass = () => ({planVersion:1});',
  '../passExport': 'export const generateRoomQrDataUrl = async () => "data:image/png;base64,fixture"; export const downloadPassImage = async () => {};',
  './PersonalPassView': 'export const PersonalPassView = () => null;',
  './PrivateJourneyMap': 'export const PrivateJourneyMap = () => null;',
  '@/features/meeting-point/roomLink': 'export const shareLinkFor = code => `https://fixture.invalid/?meet=${code}`;',
});
const fixture = globalThis.__outingUiFixture;
const room = { code: 'ABCDEFGH', confirmedPlan: { version: 2, arrivalTime: '2026-10-10T18:30:00+08:00', venue: { name: 'Public venue' } } };
fixture.state = { status: 'ready', pass: { planVersion: 1, status: 'Ready' }, options: [] };
const props = { room, me: { id: 'self-row', userId: 'self', at: { lat: 3.1, lon: 101.6 }, source: 'map', label: null }, members: [], onBack() {}, async onSuggestTime() {}, async onPublishStatus(status, version) { fixture.published.push({ status, version }); } };
await act(async () => { view = create(React.createElement(GroupOutingView, props)); });
check(fixture.published, [{ status: 'Not checked', version: 2 }]);
fixture.state = { status: 'ready', pass: { planVersion: 2, status: 'Ready' }, options: [] };
await act(async () => view.update(React.createElement(GroupOutingView, { ...props })));
check(fixture.published.at(-1), { status: 'Ready', version: 2 });
fixture.state = { status: 'failed', message: 'Fixture routing failure', previous: null };
await act(async () => view.update(React.createElement(GroupOutingView, { ...props })));
check(fixture.published.at(-1), { status: 'Not checked', version: 2 });
check(JSON.stringify(view.toJSON()).includes('Fixture routing failure'), true);
await act(async () => view.unmount());
console.log(`Outing UI privacy and plan-version checks passed: ${checks}. Controlled fixtures.`);
