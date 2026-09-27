/**
 * Builds src/shared/data/bus/stop-services.json: every bus stop the routing engine can
 * board at, with the routes that call there and the rail stations each route passes.
 *
 * First-mile access (US 3.1) lists bus stops alongside rail stations, because for most of
 * the Klang Valley the nearest boardable service is a bus: within ~800 m, 15% of suburbs
 * and towns have a rail station, and another 52% have only a bus stop. A bus stop on its
 * own tells a rider little, so each route carries the rail stations it passes — the
 * feeder bus is worth knowing about because it is the way to the train.
 *
 * Built from the two feeds loaded into the OTP graph (see routing/README.md), so every
 * stop listed here is one a journey can actually use:
 *
 *   rapid-bus-kl          Rapid KL trunk buses   (route "300", "Terminal Maluri ~ Lebuh Ampang")
 *   rapid-bus-mrtfeeder   MRT feeder buses       (route "T801", headsign "MRT SURIAN - SEK 11 ...")
 *
 * Download both into data/gtfs/ first (routing/README.md, section 3b), then:
 *
 *   node scripts/build-bus-stop-services.mjs
 *
 * The existing src/shared/data/bus/stops.json (trunk stops only, used by Epic 4's delay
 * popup and search) is left untouched.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'shared', 'data', 'bus', 'stop-services.json');
const RAIL = join(ROOT, 'src', 'shared', 'data', 'rail', 'stops.json');

const FEEDS = [
  { dir: 'rapid-bus-kl', feed: 'rapid-bus-kl', source: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl' },
  { dir: 'rapid-bus-mrtfeeder', feed: 'rapid-bus-mrtfeeder', source: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder' },
];

/** A route "passes" a station when one of its stops is this close to it. */
const RAIL_LINK_METRES = 250;

function parseLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { values.push(current); current = ''; }
    else current += c;
  }
  values.push(current);
  return values;
}

function readTable(dir, name) {
  const text = readFileSync(join(ROOT, 'data', 'gtfs', dir, name), 'utf8').replace(/^﻿/, '');
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const header = parseLine(head).map(h => h.trim());
  return lines.map(line => {
    const v = parseLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (v[i] ?? '').trim()]));
  });
}

function metres(a, b) {
  const dLat = (a.lat - b.lat) * 110_574;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Title case for names the feeds publish in capitals, keeping transit acronyms whole. */
const ACRONYMS = new Set(['MRT', 'LRT', 'BRT', 'KTM', 'KL', 'KLCC', 'LDP', 'PJ', 'USJ', 'SS', 'UKM', 'UM', 'UPM', 'PPR', 'KLIA', 'TTDI', 'SMK', 'SK']);
const titleCase = s =>
  s.toLowerCase().replace(/\b([a-z][a-z0-9]*)/g, w =>
    ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));

/**
 * Most trunk stops are named with their pole code first ("KL1132 BANGSAR TELAWI",
 * "PJ395 MRT KOTA DAMANSARA"): about 3,300 of 4,053. The code means nothing to a rider
 * looking for the stop, so it is dropped.
 */
const stopName = raw => titleCase(raw.replace(/^[A-Z]{1,4}\d+\s+/, ''));

function main() {
  const railStations = JSON.parse(readFileSync(RAIL, 'utf8')).stations;

  const routes = [];
  const stops = new Map();

  for (const { dir, feed } of FEEDS) {
    const stopRows = readTable(dir, 'stops.txt');
    const routeRows = readTable(dir, 'routes.txt');
    const tripRows = readTable(dir, 'trips.txt');
    const stopTimeRows = readTable(dir, 'stop_times.txt');

    const tripRoute = new Map(tripRows.map(t => [t.trip_id, t.route_id]));
    const headsigns = new Map();
    for (const t of tripRows) {
      if (!t.trip_headsign) continue;
      if (!headsigns.has(t.route_id)) headsigns.set(t.route_id, new Set());
      headsigns.get(t.route_id).add(t.trip_headsign);
    }

    const stopsByRoute = new Map();
    for (const st of stopTimeRows) {
      const routeId = tripRoute.get(st.trip_id);
      if (!routeId) continue;
      if (!stopsByRoute.has(routeId)) stopsByRoute.set(routeId, new Set());
      stopsByRoute.get(routeId).add(st.stop_id);
    }

    const stopById = new Map(stopRows.map(s => [s.stop_id, { lat: Number(s.stop_lat), lon: Number(s.stop_lon), name: s.stop_name }]));

    for (const r of routeRows) {
      const served = stopsByRoute.get(r.route_id);
      if (!served || served.size === 0) continue;

      // The feeder feed leaves route_short_name empty and puts the number in the long
      // name; its trips carry the useful description as a headsign instead.
      const name = r.route_short_name || r.route_long_name;
      const description = r.route_short_name
        ? r.route_long_name
        : [...(headsigns.get(r.route_id) ?? [])].sort()[0] ?? '';

      const railLinks = railStations
        .filter(station => [...served].some(id => {
          const s = stopById.get(id);
          return s && metres(s, station) <= RAIL_LINK_METRES;
        }))
        .map(station => station.stopId);

      const index = routes.length;
      routes.push({ id: r.route_id, feed, name, description: titleCase(description), railLinks });

      for (const id of served) {
        const s = stopById.get(id);
        if (!s) continue;
        if (!stops.has(id)) stops.set(id, { id, name: stopName(s.name), lat: s.lat, lon: s.lon, routes: [] });
        stops.get(id).routes.push(index);
      }
    }
  }

  const doc = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/build-bus-stop-services.mjs',
    sources: FEEDS.map(f => f.source),
    railLinkMetres: RAIL_LINK_METRES,
    routes,
    // Compact rows: [stopId, name, lat, lon, routeIndexes]. 6,000+ stops ship in the bundle.
    stops: [...stops.values()].map(s => [s.id, s.name, Number(s.lat.toFixed(6)), Number(s.lon.toFixed(6)), s.routes]),
  };

  writeFileSync(OUT, JSON.stringify(doc) + '\n');
  const linked = routes.filter(r => r.railLinks.length > 0).length;
  console.log(`routes ${routes.length} (${linked} pass a rail station), stops ${doc.stops.length}`);
  console.log(`wrote ${OUT}`);
}

main();
