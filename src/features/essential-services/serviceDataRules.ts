import type { ServiceCategory, ServiceLocation } from '@/shared/types/service';

/**
 * Documented OSM-to-user-category rules for Epic 5. The raw tag is kept on each record
 * so a reviewer can see why a service received its category.
 */
export function categoryFromOsmTag(sourceCategory: string): ServiceCategory {
  const tag = sourceCategory.toLowerCase();
  if (tag.includes('hospital')) return 'hospital';
  if (tag.includes('clinic') || tag.includes('doctors') || tag.includes('doctor')) return 'clinic';
  if (tag.includes('pharmacy')) return 'pharmacy';
  if (tag.includes('school') || tag.includes('college') || tag.includes('university') || tag.includes('kindergarten')) return 'school';
  // Before the market rule, which matches 'mall' as a substring and would swallow it.
  if (tag.includes('mall')) return 'mall';
  if (tag.includes('marketplace') || tag.includes('supermarket') || tag.includes('convenience') || tag.includes('grocery')) return 'market';
  if (tag.includes('government') || tag.includes('townhall')) return 'govt';
  if (tag.includes('park') || tag.includes('garden') || tag.includes('playground')) return 'park';
  if (tag.includes('bank') || tag.includes('atm')) return 'bank';
  if (tag.includes('police')) return 'police';
  if (tag.includes('childcare')) return 'childcare';
  if (tag.includes('restaurant') || tag.includes('cafe') || tag.includes('fast_food')) return 'food';
  return 'other';
}

/** AC 5.2.4 — no missing value is replaced with a plausible-looking default. */
export function missingServiceFields(service: ServiceLocation): string[] {
  const missing: string[] = [];
  if (!service.address?.trim()) missing.push('address');
  if (!service.hours?.trim()) missing.push('opening hours');
  if (service.lat === undefined || service.lon === undefined) missing.push('location');
  if (service.estimatedTravelTime === undefined) missing.push('estimated travel time');
  return missing;
}

/** AC 5.2.3 — OSM node/way duplicates with the same name and nearby coordinates count once. */
export function deduplicateServices(services: ServiceLocation[], radiusMetres = 60): ServiceLocation[] {
  const result: ServiceLocation[] = [];
  const grid = new Map<string, ServiceLocation[]>();
  const cellSize = radiusMetres / 111_000;

  for (const service of services) {
    if (service.lat === undefined || service.lon === undefined) continue;
    const gx = Math.floor(service.lon / cellSize);
    const gy = Math.floor(service.lat / cellSize);
    const neighbours: ServiceLocation[] = [];

    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        neighbours.push(...(grid.get(`${x}:${y}`) ?? []));
      }
    }

    const duplicate = neighbours.some(existing =>
      existing.name.trim().toLowerCase() === service.name.trim().toLowerCase() &&
      distanceMetres(existing.lat!, existing.lon!, service.lat!, service.lon!) <= radiusMetres,
    );
    if (duplicate) continue;

    result.push(service);
    const key = `${gx}:${gy}`;
    grid.set(key, [...(grid.get(key) ?? []), service]);
  }
  return result;
}

function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot((lat2 - lat1) * latScale, (lon2 - lon1) * lonScale);
}

