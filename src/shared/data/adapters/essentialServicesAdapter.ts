import { databaseData } from '../databaseData';
import type { ServiceLocation } from '@/shared/types/service';
import { categoryFromOsmTag, deduplicateServices, missingServiceFields } from '@/features/essential-services/serviceDataRules';

interface RawServiceRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sourceCategory: string;
  address?: string;
  hours?: string;
  accessible?: boolean;
}

export const ESSENTIAL_SERVICES_SOURCE = 'OpenStreetMap via Overpass API';
export const ESSENTIAL_SERVICES_LICENCE = 'ODbL — OpenStreetMap contributors';

function prepareService(raw: RawServiceRecord): ServiceLocation {
  const service: ServiceLocation = {
    id: raw.id,
    name: raw.name,
    category: categoryFromOsmTag(raw.sourceCategory),
    sourceCategory: raw.sourceCategory,
    sourceDataset: ESSENTIAL_SERVICES_SOURCE,
    lat: raw.lat,
    lon: raw.lon,
    pos: { x: 0, y: 0 },
    address: raw.address,
    hours: raw.hours,
    accessible: raw.accessible,
  };
  service.missingFields = missingServiceFields(service);
  return service;
}

let services: ServiceLocation[] | null = null;

/** Real OSM service records, normalised and deduplicated for Epic 5. */
export function loadEssentialServices(): ServiceLocation[] {
  services ??= deduplicateServices(
    (databaseData().essentialServices as RawServiceRecord[]).map(prepareService),
  );
  return services;
}

export function loadEssentialServicesMetadata() {
  return databaseData().servicesMetadata as {
    source: string; licence: string; generatedAt: string;
    bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    recordCount: number;
  };
}
