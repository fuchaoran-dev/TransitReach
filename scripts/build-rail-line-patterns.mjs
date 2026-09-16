/**
 * Builds route-specific stop order and in-vehicle travel offsets for Epic 3.
 *
 * Input:
 *   data/gtfs/rapid-rail-kl/trips.txt
 *   data/gtfs/rapid-rail-kl/stop_times.txt
 *   src/shared/data/rail/stops.json
 *
 * Output:
 *   src/shared/data/rail/line-patterns.json
 *
 * The output is intentionally small and browser-friendly. It contains only the
 * selected-line information needed to answer:
 *
 *   "If I board this exact rail/BRT line at this station, which downstream
 *    stations can I reach before my journey budget runs out?"
 *
 * It does not create new timetable claims. Stop-to-stop travel offsets come from
 * the feed's published trip pattern. Frequency/headway remains in feeds.json and
 * is handled separately by the frontend as a modelled wait assumption.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEED_DIR = join(ROOT, 'data', 'gtfs', 'rapid-rail-kl');
const RAIL_DIR = join(ROOT, 'src', 'shared', 'data', 'rail');

function parseCsv(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  row.push(field);
  rows.push(row);

  const header = rows.shift().map(value => value.trim());

  return rows
    .filter(values => values.length === header.length && values.some(value => value !== ''))
    .map(values => Object.fromEntries(header.map((name, index) => [name, values[index].trim()])));
}

function readTable(name) {
  return parseCsv(readFileSync(join(FEED_DIR, name), 'utf8'));
}

function toSeconds(value) {
  const [hours, minutes, seconds = 0] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function main() {
  const trips = readTable('trips.txt');
  const stopTimes = readTable('stop_times.txt');
  const stopsDocument = JSON.parse(readFileSync(join(RAIL_DIR, 'stops.json'), 'utf8'));

  const platformToStation = new Map();
  for (const station of stopsDocument.stations ?? []) {
    for (const platformStopId of station.platforms ?? []) {
      platformToStation.set(platformStopId, station.stopId);
    }
  }

  const stopTimesByTrip = new Map();
  for (const stopTime of stopTimes) {
    if (!stopTimesByTrip.has(stopTime.trip_id)) {
      stopTimesByTrip.set(stopTime.trip_id, []);
    }
    stopTimesByTrip.get(stopTime.trip_id).push(stopTime);
  }

  for (const list of stopTimesByTrip.values()) {
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }

  // All MonFri/Sat/Sun variants currently share the same stop order and running
  // offsets for a route/direction. Keep one deterministic representative pattern.
  const representativeTripByRouteDirection = new Map();

  for (const trip of trips) {
    const key = `${trip.route_id}|${trip.direction_id}`;
    const existing = representativeTripByRouteDirection.get(key);

    if (!existing || trip.trip_id.localeCompare(existing.trip_id) < 0) {
      representativeTripByRouteDirection.set(key, trip);
    }
  }

  const patternsByRoute = new Map();

  for (const trip of representativeTripByRouteDirection.values()) {
    const rawPattern = stopTimesByTrip.get(trip.trip_id) ?? [];
    if (rawPattern.length < 2) continue;

    const baseDepartureSeconds = toSeconds(rawPattern[0].departure_time);

    const stops = rawPattern
      .map(stopTime => {
        const stationId = platformToStation.get(stopTime.stop_id);
        if (!stationId) return null;

        return {
          stationId,
          platformStopId: stopTime.stop_id,
          sequence: Number(stopTime.stop_sequence),
          arrivalOffsetSeconds:
            toSeconds(stopTime.arrival_time) - baseDepartureSeconds,
          departureOffsetSeconds:
            toSeconds(stopTime.departure_time) - baseDepartureSeconds,
        };
      })
      .filter(Boolean);

    if (stops.length < 2) continue;

    if (!patternsByRoute.has(trip.route_id)) {
      patternsByRoute.set(trip.route_id, []);
    }

    patternsByRoute.get(trip.route_id).push({
      directionId: Number(trip.direction_id),
      tripHeadsign: trip.trip_headsign,
      stops,
    });
  }

  const routes = [...patternsByRoute.entries()]
    .map(([routeId, directions]) => ({
      routeId,
      directions: directions.sort((a, b) => a.directionId - b.directionId),
    }))
    .sort((a, b) => a.routeId.localeCompare(b.routeId));

  const output = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/build-rail-line-patterns.mjs',
    source: 'data/gtfs/rapid-rail-kl',
    routes,
  };

  writeFileSync(
    join(RAIL_DIR, 'line-patterns.json'),
    `${JSON.stringify(output, null, 2)}\n`,
  );

  console.log(`wrote ${routes.length} route patterns to src/shared/data/rail/line-patterns.json`);
  for (const route of routes) {
    console.log(
      `  ${route.routeId.padEnd(4)} ${route.directions.map(direction => `${direction.directionId}:${direction.stops.length}`).join('  ')}`,
    );
  }
}

main();
