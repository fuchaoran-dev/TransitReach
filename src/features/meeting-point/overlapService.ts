import * as polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';

// The package's ESM build — the one Vite serves — exports a single default object, while its
// type declarations describe named functions. A named import type-checks and then fails in the
// browser, so take the default object when there is one.
const { intersection } =
  (polygonClipping as unknown as { default?: typeof polygonClipping }).default ?? polygonClipping;

export type OverlapPolygon = Polygon;

/**
 * Overlap pieces smaller than this are dropped.
 *
 * Isochrone outlines are contours, and two of them that merely touch intersect in slivers a few
 * metres wide. Reporting one would tell a group they can meet when there is nowhere to stand.
 * 0.02 km² is roughly a 140 m square — a city block, the least that works as a meeting place.
 */
const MIN_PIECE_KM2 = 0.02;

const EARTH_KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Shoelace area of a [lon, lat] ring in km², on a local equirectangular approximation. */
function ringAreaKm2(ring: Ring): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const kx = kmPerDegLon(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * kx * (y2 * EARTH_KM_PER_DEG_LAT) - x2 * kx * (y1 * EARTH_KM_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

function polygonAreaKm2([outer, ...holes]: Polygon): number {
  return ringAreaKm2(outer) - holes.reduce((sum, hole) => sum + ringAreaKm2(hole), 0);
}

const toMultiPolygon = (regions: IsochroneRegion[]): MultiPolygon =>
  regions.map(region => [region.outer, ...region.holes]);

/**
 * The ground every one of these areas covers, as disjoint polygons in GeoJSON [lon, lat] order.
 * Empty when there is none. May throw on degenerate geometry; the caller reports that.
 */
export function intersectAreas(areas: IsochroneRegion[][]): OverlapPolygon[] {
  if (areas.length === 0 || areas.some(regions => regions.length === 0)) return [];
  const [first, ...rest] = areas.map(toMultiPolygon);
  return intersection(first, ...rest).filter(polygon => polygonAreaKm2(polygon) >= MIN_PIECE_KM2);
}

/** Every outer-ring vertex as [lat, lon], for framing the map on the overlap. */
export function overlapPoints(polygons: OverlapPolygon[]): [number, number][] {
  return polygons.flatMap(([outer]) => outer.map(([lon, lat]) => [lat, lon] as [number, number]));
}
