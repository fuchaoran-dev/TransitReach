import polygonClipping from 'polygon-clipping';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function closedRing(ring: Ring): Ring {
  if (ring.length === 0) return [];

  const copy = ring.map(
    ([lon, lat]) => [lon, lat] as Position,
  );

  if (!samePoint(copy[0], copy[copy.length - 1])) {
    copy.push([...copy[0]] as Position);
  }

  return copy;
}

function toMultiPolygon(
  regions: IsochroneRegion[],
): MultiPolygon {
  return regions
    .filter(region => region.outer.length >= 3)
    .map(region => [
      closedRing(region.outer),
      ...region.holes
        .filter(hole => hole.length >= 3)
        .map(closedRing),
    ]);
}

function fromMultiPolygon(
  polygons: MultiPolygon,
): IsochroneRegion[] {
  return polygons
    .filter(polygon => polygon.length > 0 && polygon[0].length >= 4)
    .map(polygon => ({
      outer: polygon[0].map(
        ([lon, lat]) => [lon, lat] as Position,
      ),
      holes: polygon
        .slice(1)
        .filter(hole => hole.length >= 4)
        .map(hole =>
          hole.map(
            ([lon, lat]) => [lon, lat] as Position,
          ),
        ),
    }));
}

/**
 * Merges overlapping/disjoint reachability regions into one valid MultiPolygon set.
 * Used by selected-line reachability after walking egress isochrones are computed from
 * every downstream station that can be reached on the chosen line.
 */
export function unionReachabilityRegions(
  groups: IsochroneRegion[][],
): IsochroneRegion[] {
  const polygons = groups
    .map(toMultiPolygon)
    .filter(group => group.length > 0);

  if (polygons.length === 0) {
    return [];
  }

  const [first, ...rest] = polygons;

  const merged = polygonClipping.union(
    first,
    ...rest,
  ) as MultiPolygon;

  return fromMultiPolygon(merged);
}

/**
 * Keeps the secondary reachability strictly inside the already-computed total origin
 * reachability area. Independent OTP contouring can otherwise create small protrusions.
 */
export function clipReachabilityRegions(
  secondary: IsochroneRegion[],
  total: IsochroneRegion[],
): IsochroneRegion[] {
  if (secondary.length === 0 || total.length === 0) {
    return [];
  }

  const secondaryMulti = toMultiPolygon(secondary);
  const totalMulti = toMultiPolygon(total);

  if (secondaryMulti.length === 0 || totalMulti.length === 0) {
    return [];
  }

  const clipped = polygonClipping.intersection(
    secondaryMulti,
    totalMulti,
  ) as MultiPolygon;

  return fromMultiPolygon(clipped);
}
