import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import { loadBusStops } from '@/features/first-mile/busStopService';
import { loadRailStops } from '@/shared/data/adapters/gtfsAdapter';
import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import type { SharedMemberStatus } from '../types';
import { selectRadarPois, type RadarCategory, type RadarPoi } from '../radarScan';
import { MeetingRadar } from './MeetingRadar';

export interface RadarPlace {
  id: string;
  label: string;
  category: RadarCategory;
  lat: number;
  lon: number;
}

const NO_MEMBERS: SharedMemberStatus[] = [];

function referencePlaces(): RadarPlace[] {
  const services = loadEssentialServices().flatMap(service => {
    const category: RadarCategory | null = service.sourceCategory === 'amenity=cafe' ? 'cafe'
      : service.category === 'food' ? 'restaurant' : service.category === 'mall' ? 'shopping' : null;
    return category && service.lat !== undefined && service.lon !== undefined
      ? [{ id: service.id, label: service.name, category, lat: service.lat, lon: service.lon }] : [];
  });
  return [
    ...services,
    ...loadRailStops().map(stop => ({ id: `rail-${stop.stopId}`, label: stop.name, category: 'train' as const, lat: stop.lat, lon: stop.lon })),
    ...loadBusStops().map(stop => ({ id: `bus-${stop.stopId}`, label: stop.name, category: 'bus' as const, lat: stop.lat, lon: stop.lon })),
  ];
}

/** Real anchors follow Leaflet pan/zoom/resize. Discovery never implies reachability or votes. */
export function MeetingRadarLayer({ members = NO_MEMBERS, places }: { members?: SharedMemberStatus[]; places?: RadarPlace[] }) {
  const map = useMap();
  const references = useMemo(() => places ?? referencePlaces(), [places]);
  const [scene, setScene] = useState<{ diameter: number; pois: RadarPoi[] } | null>(null);
  useEffect(() => {
    const project = () => {
      const { x: width, y: height } = map.getSize();
      const diameter = Math.max(160, Math.min(460, width * 0.86, height * 0.65));
      const points: RadarPoi[] = [];
      const bounds = map.getBounds();
      const add = (place: RadarPlace) => {
        if (!bounds.contains([place.lat, place.lon])) return;
        const p = map.latLngToContainerPoint([place.lat, place.lon]);
        // The existing centred group reserves 38px + 12px beneath the scanner for status.
        points.push({ ...place, x: p.x - width / 2, y: p.y - (height / 2 - 25) });
      };
      references.forEach(add);
      members.forEach(member => {
        if (member.at) add({ id: `member-${member.id}`, label: member.displayName, category: 'meeting', ...member.at });
      });
      setScene({ diameter, pois: selectRadarPois(points, diameter / 2) });
    };
    project();
    map.on('move zoom resize', project);
    return () => { map.off('move zoom resize', project); };
  }, [map, references, members]);
  // Portal keeps the existing page-centred scanner above map layers, below room panels.
  return createPortal(<MeetingRadar diameter={scene?.diameter} pois={scene?.pois} />, map.getContainer());
}
