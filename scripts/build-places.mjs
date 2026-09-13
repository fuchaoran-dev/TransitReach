/**
 * Derives the searchable named-place set from OpenStreetMap.
 *
 * Input:  Overpass API, queried live when this script is run
 * Output: src/shared/data/places/places.json
 *
 * Run manually and commit the output. This is not wired into `npm run build`.
 *
 *   node scripts/build-places.mjs
 *
 * Why this exists
 * ---------------
 * Mentors asked why a starting point could only be a station. It could not, strictly —
 * a map click already sets an arbitrary origin — but there was no way to *type* the name
 * of a suburb or a mall and land on it.
 *
 * The obvious fix is a live geocoding call per keystroke. AC 1.1.3 forbids that, and the
 * Epic 1 Definition of Done states "No geocoding endpoint is called by the application".
 * Both remain satisfied by doing the lookup **here**, once, at build time, and committing
 * the result: the application ships with the places already in it and calls nothing.
 *
 * That is the same shape as scripts/build-rail-stops.mjs, which fetches the GTFS feed
 * out-of-band and commits a derived JSON. A build-time data dependency is not a runtime
 * service call, and the distinction is the whole reason this approach was chosen.
 *
 * It is also simply better: results are instant, there is no rate limit to respect, no
 * network failure path to handle, and no user's query is sent to a third party.
 *
 * Licensing
 * ---------
 * The output is derived from OpenStreetMap and is therefore ODbL-licensed, exactly like
 * the map tiles. Attribution is already displayed permanently by Leaflet's attribution
 * control (AC 1.3.3), which covers this use too.
 *
 * Re-running
 * ----------
 * Rerun when the study area changes or the place set goes stale. Overpass is a shared
 * public service — run it sparingly, and do not put it in CI.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'shared', 'data', 'places');
const STOPS_JSON = join(ROOT, 'src', 'shared', 'data', 'rail', 'stops.json');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * The Klang Valley study area, as south,west,north,east.
 * Matches the bbox used for clipping the OSM extract in routing/README.md.
 */
const BBOX = { south: 2.79, west: 101.31, north: 3.37, east: 101.93 };

/**
 * Two places merge into one only if they are within this distance and share a name.
 * Mirrors PLATFORM_MERGE_METRES in build-rail-stops.mjs: malls and hospitals routinely
 * appear as both a node and an enclosing way, and both carry the same name.
 */
const PLACE_MERGE_METRES = 500;

/**
 * What a rider might plausibly type as a destination, and nothing else.
 *
 * Deliberately excludes highways, addresses and house numbers. AC 1.1.3's requirement
 * that an address-like string is an ordinary non-match survives because street addresses
 * are never indexed here — "Jalan Ampang 50450" still matches nothing.
 *
 * Each entry maps an OSM tag filter to the `kind` shown in the interface.
 */
const CATEGORIES = [
  { kind: 'city',       label: 'City',           filter: '["place"="city"]' },
  { kind: 'town',       label: 'Town',           filter: '["place"="town"]' },
  { kind: 'suburb',     label: 'Suburb',         filter: '["place"="suburb"]' },
  { kind: 'suburb',     label: 'Suburb',         filter: '["place"="quarter"]' },
  { kind: 'suburb',     label: 'Suburb',         filter: '["place"="neighbourhood"]' },
  { kind: 'town',       label: 'Town',           filter: '["place"="village"]' },
  { kind: 'hospital',   label: 'Hospital',       filter: '["amenity"="hospital"]' },
  { kind: 'university', label: 'University',     filter: '["amenity"="university"]' },
  { kind: 'university', label: 'College',        filter: '["amenity"="college"]' },
  { kind: 'mall',       label: 'Shopping mall',  filter: '["shop"="mall"]' },
  { kind: 'mall',       label: 'Shopping mall',  filter: '["shop"="department_store"]' },
  { kind: 'attraction', label: 'Attraction',     filter: '["tourism"="attraction"]' },
  { kind: 'attraction', label: 'Museum',         filter: '["tourism"="museum"]' },
  { kind: 'airport',    label: 'Airport',        filter: '["aeroway"="aerodrome"]' },
];

// ---------------------------------------------------------------- geo

/**
 * Reads a position from an Overpass element.
 *
 * Nodes carry lat/lon directly. Ways and relations carry a bounding box, whose centre is
 * the best available point. Anything with neither is a hard error rather than a silent
 * skip — the same stance readCoord() takes in build-rail-stops.mjs, because a place with
 * no position is a bug in the query, not a data quirk to absorb.
 */
function readCoord(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { lat: element.lat, lon: element.lon };
  }
  const b = element.bounds;
  if (b && Number.isFinite(b.minlat) && Number.isFinite(b.minlon)) {
    return { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 };
  }
  throw new Error(
    `${element.type}/${element.id} has neither lat/lon nor bounds. ` +
    'The Overpass query must request "out center bb;" so ways and relations carry a position.'
  );
}

function metresBetween(a, b) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round6 = n => Math.round(n * 1e6) / 1e6;

/** Case- and punctuation-insensitive key, for matching the same name spelled differently. */
const nameKey = name => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const inBbox = p =>
  p.lat >= BBOX.south && p.lat <= BBOX.north && p.lon >= BBOX.west && p.lon <= BBOX.east;

// ---------------------------------------------------------------- fetch

function buildQuery() {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  // Only named features are requested. An unnamed feature is unsearchable by definition,
  // so filtering server-side keeps the response a fraction of the size.
  const clauses = CATEGORIES.flatMap(({ filter }) =>
    ['node', 'way', 'relation'].map(type => `  ${type}${filter}["name"](${bbox});`)
  ).join('\n');

  return `[out:json][timeout:180];\n(\n${clauses}\n);\nout center bb tags;`;
}

async function fetchPlaces() {
  const query = buildQuery();
  console.log(`Querying Overpass for ${CATEGORIES.length} tag filters across the study area…`);
  console.log('(this usually takes 30-90s; the endpoint is shared and rate-limited)\n');

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass answers 406 to a request with no identifying User-Agent, and OSM's
      // usage policy requires one regardless. Identify the project, not a browser.
      'User-Agent': 'TransitReach-KL/1.0 (FIT5120 student project; build-places.mjs)',
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(
      `Overpass returned ${response.status} ${response.statusText}. ` +
      'A 429 or 504 means the shared endpoint is busy — wait a few minutes and retry.'
    );
  }

  const body = await response.json();
  if (!Array.isArray(body.elements)) {
    throw new Error('Overpass response contained no elements array.');
  }
  return body.elements;
}

/** Which category an element belongs to, resolved from its own tags. */
function classify(tags) {
  if (tags.place === 'city') return { kind: 'city', label: 'City' };
  if (tags.place === 'town' || tags.place === 'village') return { kind: 'town', label: 'Town' };
  if (tags.place === 'suburb' || tags.place === 'quarter' || tags.place === 'neighbourhood') {
    return { kind: 'suburb', label: 'Suburb' };
  }
  if (tags.amenity === 'hospital') return { kind: 'hospital', label: 'Hospital' };
  if (tags.amenity === 'university') return { kind: 'university', label: 'University' };
  if (tags.amenity === 'college') return { kind: 'university', label: 'College' };
  if (tags.shop === 'mall') return { kind: 'mall', label: 'Shopping mall' };
  if (tags.shop === 'department_store') return { kind: 'mall', label: 'Shopping mall' };
  if (tags.tourism === 'attraction') return { kind: 'attraction', label: 'Attraction' };
  if (tags.tourism === 'museum') return { kind: 'attraction', label: 'Museum' };
  if (tags.aeroway === 'aerodrome') return { kind: 'airport', label: 'Airport' };
  return null;
}

// ---------------------------------------------------------------- build

async function main() {
  const elements = await fetchPlaces();
  console.log(`Overpass returned ${elements.length} elements.\n`);

  const stationNames = new Set(
    JSON.parse(readFileSync(STOPS_JSON, 'utf8')).stations.map(s => nameKey(s.name))
  );

  const skipped = { unnamed: 0, unclassified: 0, outOfBbox: 0, duplicate: 0, isStation: 0 };
  const kept = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = (tags.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) { skipped.unnamed++; continue; }

    const category = classify(tags);
    if (!category) { skipped.unclassified++; continue; }

    const at = readCoord(element);
    if (!inBbox(at)) { skipped.outOfBbox++; continue; }

    const key = nameKey(name);

    // A station already in the feed wins: stops.json carries the authoritative position
    // from stop_lat/stop_lon, and two "KLCC" rows with different coordinates would be
    // worse than one.
    if (stationNames.has(key)) { skipped.isStation++; continue; }

    // Malls and hospitals commonly appear as a node inside their own way. Same name,
    // near enough the same spot, one entry.
    const duplicate = kept.find(
      place => nameKey(place.name) === key && metresBetween(place, at) <= PLACE_MERGE_METRES
    );
    if (duplicate) { skipped.duplicate++; continue; }

    kept.push({
      placeId: `${element.type[0]}${element.id}`,
      name,
      kind: category.kind,
      kindLabel: category.label,
      lat: round6(at.lat),
      lon: round6(at.lon),
    });
  }

  kept.sort((a, b) => a.name.localeCompare(b.name));

  const byKind = {};
  for (const place of kept) byKind[place.kind] = (byKind[place.kind] ?? 0) + 1;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'places.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/build-places.mjs',
        source: 'OpenStreetMap via Overpass API',
        licence: 'ODbL — https://www.openstreetmap.org/copyright',
        bbox: BBOX,
        placeCount: kept.length,
        places: kept,
      },
      null,
      2
    ) + '\n'
  );

  console.log(`Wrote ${kept.length} places to src/shared/data/places/places.json\n`);
  console.log('By kind:');
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(12)} ${count}`);
  }
  console.log('\nSkipped:');
  for (const [reason, count] of Object.entries(skipped)) {
    if (count) console.log(`  ${reason.padEnd(14)} ${count}`);
  }
  console.log(
    '\nSanity-check the counts above before committing. A collapse to near zero means ' +
    'the query or the bbox is wrong, not that the Klang Valley emptied.'
  );
}

main().catch(error => {
  console.error('\nbuild-places failed:', error.message);
  process.exit(1);
});
