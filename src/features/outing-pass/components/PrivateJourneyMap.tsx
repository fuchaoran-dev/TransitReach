import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VectorBaseLayer } from '@/features/reachability/map';
import type { PersonalPass } from '../types';
import { legColour, legTitle } from './legPresentation';

function RouteBounds({ pass, sheetCoverage }: { pass: PersonalPass; sheetCoverage: number }) {
  const map = useMap();
  const positions = useMemo(() => [
    ...pass.legs.flatMap(leg => leg.geometry.map(point => [point.lat, point.lon] as [number, number])),
    ...pass.legs.slice(0, 1).map(leg => [leg.from.lat, leg.from.lon] as [number, number]),
    [pass.meeting.venue.lat, pass.meeting.venue.lon] as [number, number],
  ], [pass]);
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      const covered = window.matchMedia('(max-width: 1023px)').matches ? map.getSize().y * sheetCoverage : 0;
      if (positions.length > 0) map.fitBounds(latLngBounds(positions), {
        paddingTopLeft: [40, 48], paddingBottomRight: [40, 32 + covered], maxZoom: 16, animate: false,
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(map.getContainer());
    fit();
    return () => observer.disconnect();
  }, [positions, map, sheetCoverage]);
  return null;
}

export function PrivateJourneyMap({ pass, sheetCoverage = 0 }: { pass: PersonalPass; sheetCoverage?: number }) {
  const first = pass.legs[0]?.from;
  const destination = pass.meeting.venue;
  return <section className="outing-map" aria-label="Your private journey map">
    <MapContainer center={[destination.lat, destination.lon]} zoom={13} scrollWheelZoom={false}>
      <VectorBaseLayer />
      <RouteBounds pass={pass} sheetCoverage={sheetCoverage} />
      {pass.legs.filter(leg => leg.geometry.length > 1).map(leg => <Polyline key={leg.id} positions={leg.geometry.map(point => [point.lat, point.lon])} pathOptions={{ color: legColour(leg), weight: leg.mode === 'WALK' ? 4 : 6, opacity: 0.95, dashArray: leg.mode === 'WALK' ? '2 8' : undefined, lineCap: 'round' }}><Tooltip sticky>{legTitle(leg).title}</Tooltip></Polyline>)}
      {first && <CircleMarker center={[first.lat, first.lon]} radius={7} pathOptions={{ color: '#0d141d', weight: 3, fillColor: '#74fcea', fillOpacity: 1 }}><Tooltip permanent direction="top" offset={[0, -8]} className="pass-map-label">Start · private</Tooltip></CircleMarker>}
      <CircleMarker center={[destination.lat, destination.lon]} radius={16} interactive={false} pathOptions={{ stroke: false, fillColor: '#74fcea', fillOpacity: 0.18 }} />
      <CircleMarker center={[destination.lat, destination.lon]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#14b8a6', fillOpacity: 1 }}><Tooltip permanent direction="bottom" offset={[0, 10]} className="pass-map-label is-destination">{destination.name}</Tooltip></CircleMarker>
    </MapContainer>
  </section>;
}
