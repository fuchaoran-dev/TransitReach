import servicesDoc from '../services/services.json';
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

const RAW_SERVICES = servicesDoc.services as RawServiceRecord[];

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

const SERVICES = deduplicateServices(RAW_SERVICES.map(prepareService));

/** Real OSM service records, normalised and deduplicated for Epic 5. */
export function loadEssentialServices(): ServiceLocation[] {
  return SERVICES;
}

export function loadEssentialServicesMetadata() {
  return {
    source: ESSENTIAL_SERVICES_SOURCE,
    licence: ESSENTIAL_SERVICES_LICENCE,
    generatedAt: servicesDoc.generatedAt,
    bbox: servicesDoc.bbox,
    recordCount: SERVICES.length,
  };
}

