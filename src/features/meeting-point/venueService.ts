import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import { linesForStop, loadRailStops } from '@/shared/data/adapters/gtfsAdapter';
import { overlapContains, type OverlapPolygon } from './overlapService';

export type VenueType = 'station' | 'cafe' | 'restaurant' | 'mall';

/**
 * The kinds of place a group can meet at, in the order they are offered.
 *
 * Stations lead, although AC 6.1.2 names only cafés, restaurants and malls. Everyone in the room
 * is arriving by public transport, so "meet at the station" is often the most practical answer
 * there is — and it is the one choice that is not a private business, which the team flagged as
 * this epic's untested boundary.
 */
export const VENUE_TYPES: { id: VenueType; label: string }[] = [
  { id: 'station', label: 'Stations' },
  { id: 'cafe', label: 'Cafés' },
  { id: 'restaurant', label: 'Restaurants' },
  { id: 'mall', label: 'Malls' },
];

export interface Venue {
  id: string;
  type: VenueType;
  name: string;
  /** What the place is, in words: "Café", "Fast food", or the lines serving a station. */
  kindLabel: string;
  lat: number;
  lon: number;
  address?: string;
  hours?: string;
}

/**
 * OSM tags to venue types. Fast food counts as a restaurant here: for a group choosing where to
 * meet the distinction does not change the decision, and a separate chip would be one more
 * choice to make. The popup still says which it is.
 */
const TYPE_BY_OSM_TAG: Record<string, { type: VenueType; kindLabel: string }> = {
  'amenity=cafe': { type: 'cafe', kindLabel: 'Café' },
  'amenity=restaurant': { type: 'restaurant', kindLabel: 'Restaurant' },
  'amenity=fast_food': { type: 'restaurant', kindLabel: 'Fast food' },
  'shop=mall': { type: 'mall', kindLabel: 'Mall' },
};

let cache: Venue[] | null = null;

/**
 * Every candidate venue, built once on first use.
 *
 * Services come through Epic 5's adapter, so they are the same deduplicated OpenStreetMap
 * records the services tab counts. The raw OSM tag it keeps is what separates cafés from
 * restaurants, which Epic 5's categories fold together as "Food & Meals".
 */
function allVenues(): Venue[] {
  if (cache) return cache;

  const stations: Venue[] = loadRailStops().map(stop => ({
    id: `station-${stop.stopId}`,
    type: 'station',
    name: stop.name,
    kindLabel: linesForStop(stop).map(line => line.longName).join(' · ') || 'Rail station',
    lat: stop.lat,
    lon: stop.lon,
  }));

  const services: Venue[] = loadEssentialServices().flatMap(service => {
    const match = service.sourceCategory ? TYPE_BY_OSM_TAG[service.sourceCategory] : undefined;
    if (!match || service.lat === undefined || service.lon === undefined) return [];
    return [{
      id: service.id,
      ...match,
      name: service.name,
      lat: service.lat,
      lon: service.lon,
      address: service.address,
      hours: service.hours,
    }];
  });

  cache = [...stations, ...services];
  return cache;
}

/** Every venue inside the overlap. */
export function venuesInOverlap(polygons: OverlapPolygon[]): Venue[] {
  const contains = overlapContains(polygons);
  return allVenues().filter(venue => contains(venue.lat, venue.lon));
}
