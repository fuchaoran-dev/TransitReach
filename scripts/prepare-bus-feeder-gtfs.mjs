/**
 * Prepares the Rapid KL MRT feeder bus feed for the routing engine.
 *
 * Feeder buses are the main first-mile link to rail for a rider who does not live beside
 * a station, so without them Epic 3's journeys and Epic 1's reachable areas understate
 * what a rider can actually reach. Unlike the rail feed, this one is already a real
 * timetable (explicit stop_times, no frequencies.txt), so nothing is expanded. Two
 * things are changed, both in a copy — the raw download in data/gtfs/ is untouched:
 *
 * 1. Calendars are widened to the calendar year. data.gov.my republishes this feed
 *    roughly monthly and each edition covers only about five weeks ahead (the one
 *    inspected on 2026-09-27 ran 2026-09-28 to 2026-10-31). Every computation in the app
 *    runs at one modelled departure, a typical Tuesday 08:00 (DEPARTURE_TIME in
 *    routingAdapter.ts), which falls outside that window — so loaded as published, no
 *    feeder bus would ever run in a result. The published weekday / weekend pattern is
 *    applied as the typical week instead, which is exactly what the modelled departure
 *    already assumes of the rail feed. The span matches the rail feed's live calendars.
 *    The same caution as the rail expansion applies: clock times from this feed are
 *    modelled, not a promise of a departure on a real date. Never present them as one.
 *
 * 2. route_short_name is filled from route_long_name. The feed puts the route number
 *    ("T117") in the long name and leaves the short name empty, and the journey UI
 *    reads the short name for the number on the chip.
 *
 * Download and unpack the feed first, from the repo root:
 *
 *   curl -L -o data/gtfs/rapid-bus-mrtfeeder.zip \
 *     "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder"
 *   unzip -o data/gtfs/rapid-bus-mrtfeeder.zip -d data/gtfs/rapid-bus-mrtfeeder
 *
 * then:
 *
 *   node scripts/prepare-bus-feeder-gtfs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'gtfs', 'rapid-bus-mrtfeeder');
const OUT = join(ROOT, 'routing', 'otp', 'gtfs-rapid-bus-mrtfeeder');

const SERVICE_START = '20260101';
const SERVICE_END = '20261231';

/**
 * The two files rewritten here are small and, in every edition inspected, unquoted. A
 * split is enough; a quote would mean the feed changed shape, so refuse rather than
 * mis-parse it.
 */
function readTable(name) {
  const text = readFileSync(join(SRC, name), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (text.includes('"')) throw new Error(`${name} contains quoted fields; extend the parser before using it.`);
  const [head, ...lines] = text.split('\n');
  const header = head.split(',').map(h => h.trim());
  const rows = lines.filter(Boolean).map(line => {
    const values = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, (values[i] ?? '').trim()]));
  });
  return { header, rows };
}

const toCsv = ({ header, rows }) =>
  [header.join(','), ...rows.map(r => header.map(h => r[h] ?? '').join(','))].join('\n') + '\n';

function main() {
  const calendar = readTable('calendar.txt');
  const routes = readTable('routes.txt');

  const published = calendar.rows.map(r => `${r.service_id} ${r.start_date}–${r.end_date}`);
  for (const row of calendar.rows) {
    row.start_date = SERVICE_START;
    row.end_date = SERVICE_END;
  }

  let named = 0;
  for (const row of routes.rows) {
    if (!row.route_short_name && row.route_long_name) {
      row.route_short_name = row.route_long_name;
      named++;
    }
  }
  const types = new Set(routes.rows.map(r => r.route_type));

  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith('.txt') || name === 'calendar.txt' || name === 'routes.txt') continue;
    copyFileSync(join(SRC, name), join(OUT, name));
  }
  writeFileSync(join(OUT, 'calendar.txt'), toCsv(calendar));
  writeFileSync(join(OUT, 'routes.txt'), toCsv(routes));

  console.log(`\npublished calendars : ${published.join(', ')}`);
  console.log(`widened to          : ${SERVICE_START}–${SERVICE_END}`);
  console.log(`routes              : ${routes.rows.length} (route_type ${[...types].join(', ')}), ${named} short names filled`);
  console.log(`\nwrote ${OUT}\n`);
}

main();
