/**
 * Download the real essential-service POI dataset used by Epic 5.
 *
 * Run sparingly because Overpass is a shared public service:
 *   node scripts/build-essential-services.mjs
 *
 * The generated JSON is committed so the deployed UI does not make a request for every
 * visitor. OTP still performs the travel-time computation at runtime.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'shared', 'data', 'services', 'services.json');
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const BBOX = { south: 2.79, west: 101.31, north: 3.37, east: 101.93 };

const FILTERS = [
  ['amenity', 'hospital'], ['amenity', 'clinic'], ['amenity', 'doctors'],
  ['amenity', 'pharmacy'], ['healthcare', 'hospital'], ['healthcare', 'clinic'],
  ['healthcare', 'doctor'], ['healthcare', 'pharmacy'],
  ['amenity', 'school'], ['amenity', 'kindergarten'], ['amenity', 'college'],
  ['amenity', 'university'], ['amenity', 'marketplace'], ['shop', 'supermarket'],
  ['shop', 'convenience'], ['shop', 'mall'], ['shop', 'grocery'],
  ['office', 'government'], ['amenity', 'townhall'],
  ['leisure', 'park'], ['leisure', 'garden'], ['leisure', 'playground'],
  ['amenity', 'bank'], ['amenity', 'atm'], ['amenity', 'police'],
  ['amenity', 'childcare'], ['amenity', 'restaurant'], ['amenity', 'cafe'],
  ['amenity', 'fast_food'],
];

const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const clauses = FILTERS.map(([key, value]) =>
  `nwr["${key}"="${value}"]["name"](${bbox});`
).join('\n');
const query = `[out:json][timeout:180];\n(\n${clauses}\n);\nout center tags;`;

function coordinate(element) {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center && typeof element.center.lat === 'number' && typeof element.center.lon === 'number') {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

function sourceCategory(tags) {
  const key = Object.keys(tags).find(candidate =>
    FILTERS.some(([filterKey, filterValue]) => filterKey === candidate && tags[candidate] === filterValue)
  );
  return key ? `${key}=${tags[key]}` : 'unknown';
}

function address(tags) {
  const parts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:postcode']]
    .filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function distanceMetres(a, b) {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * latScale, (a.lon - b.lon) * lonScale);
}

const response = await fetch(OVERPASS_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'TransitReach-KL/1.0 (student project; essential services dataset)',
  },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) throw new Error(`Overpass returned ${response.status} ${response.statusText}`);

const body = await response.json();
const services = [];
for (const element of body.elements ?? []) {
  const tags = element.tags ?? {};
  const name = String(tags.name ?? '').replace(/\s+/g, ' ').trim();
  const at = coordinate(element);
  if (!name || !at) continue;

  const candidate = {
    id: `${element.type[0]}${element.id}`,
    name,
    lat: Number(at.lat.toFixed(6)),
    lon: Number(at.lon.toFixed(6)),
    sourceCategory: sourceCategory(tags),
    address: address(tags),
    hours: tags.opening_hours,
    accessible: tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : undefined,
  };

  // A named OSM node inside the enclosing way is one service, not two.
  const duplicate = services.some(existing =>
    existing.name.toLowerCase() === candidate.name.toLowerCase() && distanceMetres(existing, candidate) <= 60
  );
  if (!duplicate) services.push(candidate);
}

services.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap via Overpass API',
  licence: 'ODbL — OpenStreetMap contributors',
  bbox: BBOX,
  recordCount: services.length,
  services,
}, null, 2) + '\n');
console.log(`Wrote ${services.length} deduplicated OSM services to ${OUT}`);

