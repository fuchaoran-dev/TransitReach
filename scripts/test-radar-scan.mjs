import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry, stubs = {}) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    jsx: 'automatic', external: ['react', 'react/jsx-runtime'], alias: { '@': `${process.cwd()}/src` },
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'radar-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx' }));
    } }] });
  const module = new Module(`${process.cwd()}/scripts/radar-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/radar-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const { radarAngle, radarDiscoveryAge, selectRadarPois, animateRadar } = await load('src/features/meeting-point/radarScan.ts');
check([radarAngle(0,-1), radarAngle(1,0), radarAngle(0,1), radarAngle(-1,0)], [0,90,180,270]);
check(radarAngle(-1,-1), 315);
check(radarDiscoveryAge(999,90), null);
check(radarDiscoveryAge(1000,90), 0);
check(radarDiscoveryAge(1500,90), 500);
check(radarDiscoveryAge(3999,0), 3999);
check(radarDiscoveryAge(4000,0), 0);
check(radarDiscoveryAge(5000,90), 0);
check(radarDiscoveryAge(9000,90), 0);
check(radarDiscoveryAge(12050,0), 50); // A throttled tab resumes on the latest sweep.
check(radarDiscoveryAge(3990,359) < 2, true);
check(radarDiscoveryAge(10,359), null);

const pois = [
  {id:'north',category:'cafe',label:'Synthetic north',x:0,y:-100},
  {id:'east',category:'bus',label:'Synthetic east',x:100,y:0},
];
const tracks = [];
const bubble = () => ({ animate(keyframes, options) {
  const track = {keyframes,options,currentTime:null,paused:false,cancelled:false,
    pause(){this.paused=true;},cancel(){this.cancelled=true;}};
  tracks.push(track); return track;
} });
const markers = pois.map(() => ({querySelector: () => bubble()}));
const beam = {style:{}};
let next = 0; const scheduled = new Map(); const cancelled = [];
const clock = {request(cb){scheduled.set(++next,cb);return next;},cancel(id){cancelled.push(id);scheduled.delete(id);}};
const root = {querySelector:()=>beam,querySelectorAll:()=>markers};
const stop = animateRadar(root,pois,clock);
const tick = time => { const [id,cb] = scheduled.entries().next().value; scheduled.delete(id); cb(time); };
check(tracks.length,8); check(tracks.every(t=>t.paused && t.options.duration===2800),true);
tick(100); check(beam.style.transform,'rotate(0deg)'); check(tracks.map(t=>t.currentTime),Array(8).fill(0));
tick(1600); check(beam.style.transform,'rotate(135deg)');
check(tracks[0].currentTime,1500); check(tracks[4].currentTime,500);
tick(4000); check(tracks.every(t=>t.currentTime===2800),true); // Both faded; no random timer restarts.
tick(4100); check(tracks[0].currentTime,0); check(tracks[4].currentTime,2800);
tick(5100); check(tracks[4].currentTime,0);
const staleCallback = scheduled.values().next().value;
stop(); check(tracks.every(t=>t.cancelled),true); check(scheduled.size,0); check(cancelled.length,1);
staleCallback(6100); check(scheduled.size,0);
const stopWithEpoch = animateRadar(root,pois,clock,1000);
tick(1500); check(beam.style.transform,'rotate(45deg)'); // Repositioning preserves the shared clock.
stopWithEpoch();

check(selectRadarPois([...pois,{...pois[0],id:'near-duplicate',x:2},{...pois[0],id:'outside',x:500},
  {...pois[0],id:'centre',x:0,y:0},{...pois[0],id:'invalid',x:NaN}],200).map(p=>p.id),['east','north']);
check(selectRadarPois(pois,80).length,0);
const reducedStub = { '@/shared/hooks/usePrefersReducedMotion': 'export const usePrefersReducedMotion=()=>true;' };
const {MeetingRadar} = await load('src/features/meeting-point/components/MeetingRadar.tsx',reducedStub);
const markup=renderToStaticMarkup(React.createElement(MeetingRadar,{pois}));
check(markup.includes('Finding common ground…'),true); check(markup.includes('role="status"'),true);
check((markup.match(/class="radar-poi"/g)||[]).length,2);
check(markup.includes('aria-hidden="true"'),true);
const element={dataset:{},animate(){throw new Error('Reduced motion must not animate');}};
let tree;
await act(async()=>{tree=create(React.createElement(MeetingRadar,{pois}),{createNodeMock:()=>element});});
check(element.dataset.motion,'static');
await act(async()=>{tree.unmount();});

const map = {shift:0,events:[],getSize:()=>({x:800,y:600}),getBounds:()=>({contains:()=>true}),
  latLngToContainerPoint([lat,lon]){return{x:400+(lon-101.6)*10000+this.shift,y:275+(3.1-lat)*10000};},
  getContainer:()=>({}),on(event,callback){this.events.push([event,callback]);},off(event,callback){this.detached=[event,callback];}};
globalThis.__radarMap=map;
const {MeetingRadarLayer}=await load('src/features/meeting-point/components/MeetingRadarLayer.tsx',{
  ...reducedStub,'react-dom':'export const createPortal=children=>children;',
  'react-leaflet':'export const useMap=()=>globalThis.__radarMap;',
  '@/features/first-mile/busStopService':'export const loadBusStops=()=>[];',
  '@/shared/data/adapters/gtfsAdapter':'export const loadRailStops=()=>[];',
  '@/shared/data/adapters/essentialServicesAdapter':'export const loadEssentialServices=()=>[];',
});
await act(async()=>{tree=create(React.createElement(MeetingRadarLayer,{places:[{id:'real-source',label:'Reference place',category:'cafe',lat:3.095,lon:101.61}]}));});
const marker=()=>tree.root.findAllByProps({className:'radar-poi'})[0];
check(marker().props.style.left.includes('100.'),true);
check(Math.abs(parseFloat(marker().props.style.top.split('+')[1])-50)<0.01,true);
map.shift=20;
await act(async()=>{map.events[0][1]();});
check(marker().props.style.left.includes('120.'),true);
await act(async()=>{tree.unmount();});
check(map.detached,map.events[0]);
delete globalThis.__radarMap;
console.log(`Radar scanning checks passed: ${checks}. Controlled clocks and map projections; no network or room writes.`);
