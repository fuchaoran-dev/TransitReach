/**
 * Expands a frequency-based GTFS feed into an equivalent scheduled feed.
 *
 * Why this exists
 * ---------------
 * The Prasarana rail feed publishes no timetable at all. Every trip is defined by
 * `frequencies.txt` — a headway per time window — and the build log confirms it:
 *
 *     Added 106 frequency-based and 0 single-trip timetable entries.
 *
 * OpenTripPlanner's TravelTime isochrone sandbox drives Raptor with
 * `RaptorProfile.BEST_TIME`, which handles explicit departures better than frequency
 * windows. Expanding the feed measurably widens the computed reachable area — from
 * Kwasa Damansara at 60 min with `modes=WALK,SUBWAY`, ~104 km² on the raw feed against
 * ~135 km² on the expanded one.
 *
 * To be clear about what this is and is not: transit routing works on the raw
 * frequency-based feed too. This is an improvement, not a repair. It is kept because a
 * ~30% difference in reachable area is not a rounding error.
 *
 * This script materialises each frequency window into concrete trips at the published
 * headway, and drops `frequencies.txt`. Nothing is invented: the headways are the
 * feed's own published values, and `exact_times` is absent (so 0), which is precisely
 * the case GTFS says may be expanded this way.
 *
 * IMPORTANT — the clock times this produces are an artefact of expansion, not
 * published departures. The Epic 1 Definition of Done requires that no clock time is
 * ever presented as a scheduled departure. These times exist only so the router can
 * compute durations. Never display them.
 *
 *   node scripts/expand-gtfs-frequencies.mjs
 *
 * With no arguments it expands the rail feed. Another frequency-based feed can be named
 * by its folder under data/gtfs/ and the output folder under routing/otp/:
 *
 *   node scripts/expand-gtfs-frequencies.mjs rapid-bus-kl gtfs-rapid-bus-kl-expanded
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [feedArg = 'rapid-rail-kl', outArg = 'gtfs-rapid-rail-kl-expanded'] = process.argv.slice(2);
const SRC = join(ROOT, 'data', 'gtfs', feedArg);
const OUT = join(ROOT, 'routing', 'otp', outArg);

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

// GTFS times may exceed 24:00:00 for trips running past midnight.
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

// ---------------------------------------------------------------- expand

function main() {
  const read = name => parseCsv(readFileSync(join(SRC, name), 'utf8'));

  const trips = read('trips.txt');
  const stopTimes = read('stop_times.txt');
  const frequencies = read('frequencies.txt');

  if (frequencies.rows.some(f => f.exact_times === '1')) {
    throw new Error('Feed contains exact_times=1 windows; those must not be expanded by headway.');
  }

  const windowsByTrip = new Map();
  for (const f of frequencies.rows) {
    if (!windowsByTrip.has(f.trip_id)) windowsByTrip.set(f.trip_id, []);
    windowsByTrip.get(f.trip_id).push({
      start: toSeconds(f.start_time),
      end: toSeconds(f.end_time),
      headway: Number(f.headway_secs),
    });
  }

  const stopTimesByTrip = new Map();
  for (const st of stopTimes.rows) {
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
    stopTimesByTrip.get(st.trip_id).push(st);
  }
  for (const list of stopTimesByTrip.values()) {
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }

  const outTrips = [];
  const outStopTimes = [];
  let expandedTrips = 0;
  let copiedTrips = 0;

  for (const trip of trips.rows) {
    const windows = windowsByTrip.get(trip.trip_id);
    const pattern = stopTimesByTrip.get(trip.trip_id);

    if (!pattern) {
      console.warn(`  ! trip ${trip.trip_id} has no stop_times; skipped`);
      continue;
    }

    if (!windows) {
      outTrips.push(trip);
      outStopTimes.push(...pattern);
      copiedTrips++;
      continue;
    }

    // Times in stop_times are relative to this trip's own first departure.
    const base = toSeconds(pattern[0].departure_time);
    let n = 0;

    for (const w of windows) {
      if (!Number.isFinite(w.headway) || w.headway <= 0) {
        throw new Error(`trip ${trip.trip_id} has a non-positive headway_secs`);
      }
      // GTFS: the last departure is strictly before end_time.
      for (let t = w.start; t < w.end; t += w.headway) {
        const newTripId = `${trip.trip_id}#${n++}`;
        outTrips.push({ ...trip, trip_id: newTripId });
        const offset = t - base;
        for (const st of pattern) {
          outStopTimes.push({
            ...st,
            trip_id: newTripId,
            arrival_time: toHms(toSeconds(st.arrival_time) + offset),
            departure_time: toHms(toSeconds(st.departure_time) + offset),
          });
        }
      }
    }
    expandedTrips += n;
  }

  // ---------------------------------------------------------------- write
  mkdirSync(OUT, { recursive: true });

  // Copy every other file through untouched; drop frequencies.txt.
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith('.txt')) continue;
    if (['trips.txt', 'stop_times.txt', 'frequencies.txt'].includes(name)) continue;
    copyFileSync(join(SRC, name), join(OUT, name));
  }

  writeFileSync(join(OUT, 'trips.txt'), toCsv(trips.header, outTrips));
  writeFileSync(join(OUT, 'stop_times.txt'), toCsv(stopTimes.header, outStopTimes));

  console.log(`\nsource      : ${trips.rows.length} trips, ${stopTimes.rows.length} stop_times, ${frequencies.rows.length} frequency windows`);
  console.log(`expanded    : ${expandedTrips} trips from frequency windows`);
  console.log(`copied as-is: ${copiedTrips} already-scheduled trips`);
  console.log(`output      : ${outTrips.length} trips, ${outStopTimes.length} stop_times`);
  console.log(`frequencies.txt omitted — the feed is now fully scheduled.`);
  console.log(`\nwrote ${OUT}\n`);
}

main();
