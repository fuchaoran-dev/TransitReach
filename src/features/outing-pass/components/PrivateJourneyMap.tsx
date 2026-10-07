import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VectorBaseLayer } from '@/features/reachability/map';
import type { PersonalPass } from '../types';

function RouteBounds({ pass }: { pass: PersonalPass }) {
  const map = useMap();
  const positions = useMemo(() => [
    ...pass.legs.flatMap(leg => leg.geometry.map(point => [point.lat, point.lon] as [number, number])),
    ...pass.legs.slice(0, 1).map(leg => [leg.from.lat, leg.from.lon] as [number, number]),
    [pass.meeting.venue.lat, pass.meeting.venue.lon] as [number, number],
  ], [pass]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    map.invalidateSize();
    if (positions.length > 0) map.fitBounds(latLngBounds(positions), { padding: [40, 40], maxZoom: 16, animate: false });
    return () => observer.disconnect();
  }, [positions, map]);
  return null;
}

export function PrivateJourneyMap({ pass }: { pass: PersonalPass }) {
  const first = pass.legs[0]?.from;
  const destination = pass.meeting.venue;
  return <section className="outing-map" aria-label="Your private journey map">
    <MapContainer center={[destination.lat, destination.lon]} zoom={13} scrollWheelZoom={false}>
      <VectorBaseLayer />
      <RouteBounds pass={pass} />
      {pass.legs.filter(leg => leg.geometry.length > 1).map(leg => <Polyline key={leg.id} positions={leg.geometry.map(point => [point.lat, point.lon])} pathOptions={{ color: leg.mode === 'WALK' ? '#74fcea' : leg.routeColor ?? '#60a5fa', weight: 5, dashArray: leg.mode === 'WALK' ? '8 6' : undefined }}><Tooltip sticky>{leg.mode === 'WALK' ? 'Walk' : leg.routeLongName ?? leg.routeShortName ?? leg.mode}</Tooltip></Polyline>)}
      {first && <CircleMarker center={[first.lat, first.lon]} radius={8} pathOptions={{ color: '#74fcea', fillOpacity: 1 }}><Tooltip permanent direction="top">Your start · Private</Tooltip></CircleMarker>}
      <CircleMarker center={[destination.lat, destination.lon]} radius={9} pathOptions={{ color: '#74fcea', fillColor: '#0d141d', fillOpacity: 1 }}><Tooltip permanent direction="bottom">{destination.name}</Tooltip></CircleMarker>
    </MapContainer>
  </section>;
}
