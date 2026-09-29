/**
 * Corrects two defects in the prepared bus feeds before the routing engine is built.
 *
 * Why this exists
 * ---------------
 * 1. Bus legs drawn as straight lines. Neither bus feed carries `shape_dist_traveled`, so
 *    OpenTripPlanner places each stop on its route shape by nearest point. On a loop route
 *    (T580 starts and ends at LRT Awan Besar) or one that doubles back along a road, the
 *    nearest point is often on the wrong pass, the stops then appear to run backwards, and
 *    OTP silently falls back to straight stop-to-stop lines. On the graph inspected on
 *    2026-09-29, 21 of 173 Rapid KL trunk patterns were drawn that way: a bus "flying"
 *    diagonally across the map.
 *
 *    Fix: every stop is matched to its shape in order, never going backwards along it, and
 *    the distance along the shape is written to stop_times.txt and shapes.txt. OTP then cuts
 *    the shape at those distances instead of guessing.
 *
 * 2. Physically impossible running times. The published stop_times contain hops no bus can
 *    make: on the trunk feed, 3,489 of 85,711 template hops imply more than 60 km/h in a
 *    *straight line*, 653 more than 100 km/h, and 1,706 take no time at all. T580 was timed
 *    at 2.1 km in 20 s, and at 3 min 50 s from Awan Besar to Pavilion Bukit Jalil, a 2.8 km
 *    drive that takes a car 6.4 min on empty roads. Journeys and reachable areas built on
 *    these times overstate what a bus rider can reach.
 *
 *    Fix: no hop may be faster than MAX_BUS_SPEED_KMH. A hop that is gets the minimum time
 *    that speed allows, and the rest of the trip is pushed later only as far as needed:
 *    a later published time that is still reachable is kept. Hops that were already
 *    plausible are untouched, so the published timetable survives wherever it is credible.
 *
 * ASSUMPTION — 40 km/h is our cap, not a published figure. It is an upper bound on a
 * bus's average speed between two stops in Klang Valley traffic, chosen so that it only
 * removes the impossible and does not model congestion. The times this produces are the
 * published timetable corrected where it is physically impossible, not observed running
 * times, and the interface must say so. Recorded in the epic scaffold (Epic 4).
 *
 * Distance for the speed check is along the shape when both stops sit within
 * MATCH_TOLERANCE_M of it, which is the road the bus actually drives. Otherwise, and for
 * trips with no shape, it is the straight line between the stops. That is always an
 * underestimate, so the correction there is the least it can be.
 *
 * Runs in place on the prepared copies under routing/otp/ (the raw downloads in
 * data/gtfs/ are untouched), after 3b and 3c in routing/README.md:
 *
 *   node scripts/fix-bus-timetable.mjs gtfs-rapid-bus-mrtfeeder gtfs-rapid-bus-kl-expanded
 *
 * Running it twice changes nothing further.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BUS_SPEED_KMH = 40;
const MAX_SPEED_MS = MAX_BUS_SPEED_KMH / 3.6;
const MATCH_TOLERANCE_M = 100;

// ---------------------------------------------------------------- csv

function parseCsv(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  const header = rows.shift().map(h => h.trim());
  return {
    header,
    rows: rows
      .filter(r => r.length === header.length && r.some(v => v !== ''))
      .map(r => Object.fromEntries(header.map((h, i) => [h, r[i].trim()]))),
  };
}

const esc = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
const toCsv = (header, rows) =>
  [header.join(','), ...rows.map(r => header.map(h => esc(r[h] ?? '')).join(','))].join('\n') + '\n';

function toSeconds(hms) {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}
function toHms(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- geometry

// Equirectangular metres: accurate to well under 1% over a few km at this latitude.
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((3.1 * Math.PI) / 180);
const xy = (lat, lon) => [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Projects p onto segment ab: distance from p, and fraction along ab. */
function project(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

/**
 * Places each stop on the shape, in order, never going backwards along it, minimising the
 * total distance between stops and their placements. Nearest-point matching (what OTP does
 * without shape_dist_traveled) picks each stop independently, which is what breaks loops.
 */
function matchStopsToShape(stopPts, shape) {
  const segs = shape.pts.length - 1;
  if (segs < 1) return null;
  let prevCost = null, prevAlong = null;
  const back = [];
  let cost, along;

  for (let i = 0; i < stopPts.length; i++) {
    cost = new Float64Array(segs);
    along = new Float64Array(segs);
    const from = new Int32Array(segs);
    let bestCost = Infinity, bestIdx = -1;

    for (let j = 0; j < segs; j++) {
      const { d, t } = project(stopPts[i], shape.pts[j], shape.pts[j + 1]);
      along[j] = shape.cum[j] + t * (shape.cum[j + 1] - shape.cum[j]);
      if (i === 0) { cost[j] = d; continue; }
      // Best earlier placement on a strictly earlier segment, or this one if not ahead of us.
      let c = bestCost, k = bestIdx;
      if (prevAlong[j] <= along[j] && prevCost[j] < c) { c = prevCost[j]; k = j; }
      cost[j] = d + c;
      from[j] = k;
      if (prevCost[j] < bestCost) { bestCost = prevCost[j]; bestIdx = j; }
    }
    back.push(from);
    prevCost = cost;
    prevAlong = along;
    // Keep per-stop along values for backtracking.
    back[i].along = along;
  }

  let j = 0;
  for (let k = 1; k < segs; k++) if (cost[k] < cost[j]) j = k;
  const result = new Array(stopPts.length);
  for (let i = stopPts.length - 1; i >= 0; i--) {
    const a = back[i].along[j];
    const { d } = project(stopPts[i], shape.pts[j], shape.pts[j + 1]);
    result[i] = { along: a, offset: d };
    j = back[i][j];
  }
  return result;
}

// ---------------------------------------------------------------- per feed

function fixFeed(folder) {
  const dir = join(ROOT, 'routing', 'otp', folder);
  if (!existsSync(join(dir, 'stop_times.txt'))) {
    throw new Error(`${dir} has no stop_times.txt. Prepare the feed first (routing/README.md 3b, 3c).`);
  }
  const read = name => parseCsv(readFileSync(join(dir, name), 'utf8'));
  const stops = read('stops.txt');
  const trips = read('trips.txt');
  const stopTimes = read('stop_times.txt');
  const shapesFile = existsSync(join(dir, 'shapes.txt')) ? read('shapes.txt') : { header: [], rows: [] };

  const stopPos = new Map(stops.rows.map(s => [s.stop_id, xy(Number(s.stop_lat), Number(s.stop_lon))]));

  // Shapes, ordered, with cumulative metres.
  const shapeRows = new Map();
  for (const r of shapesFile.rows) {
    if (!shapeRows.has(r.shape_id)) shapeRows.set(r.shape_id, []);
    shapeRows.get(r.shape_id).push(r);
  }
  const shapes = new Map();
  for (const [id, rows] of shapeRows) {
    rows.sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));
    const pts = rows.map(r => xy(Number(r.shape_pt_lat), Number(r.shape_pt_lon)));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    rows.forEach((r, i) => { r.shape_dist_traveled = cum[i].toFixed(1); });
    shapes.set(id, { pts, cum });
  }

  const shapeOf = new Map(trips.rows.map(t => [t.trip_id, t.shape_id || '']));
  const byTrip = new Map();
  for (const st of stopTimes.rows) {
    if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
    byTrip.get(st.trip_id).push(st);
  }

  // One match per distinct (shape, stop sequence): expanded trips share their template's.
  const patternCache = new Map();
  let patternsMatched = 0, patternsLoose = 0, hopsChecked = 0, hopsCorrected = 0, tripsCorrected = 0;
  let tripsNoShape = 0, maxTripDelay = 0;
  const delayByRoute = new Map();
  const routeOf = new Map(trips.rows.map(t => [t.trip_id, t.route_id]));

  for (const [tripId, list] of byTrip) {
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const shapeId = shapeOf.get(tripId);
    const shape = shapes.get(shapeId);
    const key = `${shapeId}|${list.map(s => s.stop_id).join(',')}`;

    let pattern = patternCache.get(key);
    if (!pattern) {
      const pts = list.map(s => stopPos.get(s.stop_id));
      if (pts.some(p => !p)) throw new Error(`trip ${tripId} references a stop missing from stops.txt`);
      const match = shape ? matchStopsToShape(pts, shape) : null;
      const hopMetres = [];
      for (let i = 1; i < list.length; i++) {
        const straight = dist(pts[i - 1], pts[i]);
        const onShape = match && match[i - 1].offset <= MATCH_TOLERANCE_M && match[i].offset <= MATCH_TOLERANCE_M;
        hopMetres.push(onShape ? Math.max(straight, match[i].along - match[i - 1].along) : straight);
      }
      // Strictly increasing, as GTFS requires of shape_dist_traveled along a trip.
      let dists = null;
      if (match) {
        dists = [];
        let last = -Infinity;
        for (const m of match) { last = Math.max(m.along, last + 0.1); dists.push(last.toFixed(1)); }
        patternsMatched++;
        if (match.some(m => m.offset > MATCH_TOLERANCE_M)) patternsLoose++;
      }
      pattern = { hopMetres, dists };
      patternCache.set(key, pattern);
    }

    if (pattern.dists) list.forEach((st, i) => { st.shape_dist_traveled = pattern.dists[i]; });
    else { tripsNoShape++; list.forEach(st => { st.shape_dist_traveled = ''; }); }

    // Retime: a hop may not beat MAX_BUS_SPEED_KMH; later published times are kept if reachable.
    let prevDep = toSeconds(list[0].departure_time);
    let tripDelay = 0;
    for (let i = 1; i < list.length; i++) {
      hopsChecked++;
      const arr = toSeconds(list[i].arrival_time);
      const dwell = Math.max(0, toSeconds(list[i].departure_time) - arr);
      const earliest = prevDep + Math.ceil(pattern.hopMetres[i - 1] / MAX_SPEED_MS);
      const newArr = Math.max(arr, earliest);
      if (newArr !== arr) {
        hopsCorrected++;
        list[i].arrival_time = toHms(newArr);
        list[i].departure_time = toHms(newArr + dwell);
      }
      tripDelay = Math.max(tripDelay, newArr - arr);
      prevDep = newArr + dwell;
    }
    if (tripDelay > 0) {
      tripsCorrected++;
      maxTripDelay = Math.max(maxTripDelay, tripDelay);
      const r = routeOf.get(tripId);
      delayByRoute.set(r, Math.max(delayByRoute.get(r) ?? 0, tripDelay));
    }
  }

  // ---------------------------------------------------------------- write
  const withDist = h => (h.includes('shape_dist_traveled') ? h : [...h, 'shape_dist_traveled']);
  const outStopTimes = [...byTrip.values()].flat();
  writeFileSync(join(dir, 'stop_times.txt'), toCsv(withDist(stopTimes.header), outStopTimes));
  if (shapesFile.rows.length) {
    const outShapes = [...shapeRows.values()].flat();
    writeFileSync(join(dir, 'shapes.txt'), toCsv(withDist(shapesFile.header), outShapes));
  }

  const worst = [...delayByRoute].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([r, s]) => `${r} +${Math.round(s / 60)} min`).join(', ');
  console.log(`\n${folder}`);
  console.log(`  trips              : ${byTrip.size} (${tripsNoShape} without a shape, straight-line distance used)`);
  console.log(`  stop patterns      : ${patternsMatched} matched to their shape, ${patternsLoose} with a stop over ${MATCH_TOLERANCE_M} m from it`);
  console.log(`  hops over ${MAX_BUS_SPEED_KMH} km/h  : ${hopsCorrected} of ${hopsChecked} corrected, on ${tripsCorrected} trips`);
  console.log(`  most added to a trip: ${Math.round(maxTripDelay / 60)} min, worst routes: ${worst || 'none'}`);
}

const folders = process.argv.slice(2);
if (!folders.length) {
  console.error('usage: node scripts/fix-bus-timetable.mjs <folder under routing/otp> [...]');
  process.exit(1);
}
for (const f of folders) fixFeed(f);
console.log(`\nwrote in place. Rebuild the graph (routing/README.md step 4).\n`);
