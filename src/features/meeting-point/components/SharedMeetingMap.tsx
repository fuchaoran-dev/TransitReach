import { useEffect, useRef } from 'react';
import { CircleMarker, Polygon, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import type { SharedMemberStatus, StartingPoint } from '../types';
import { panelPadding } from '../mapFraming';

const COLOURS = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185'];

/** Only authenticated room projections supply these saved (not continuously tracked) points. */
export function SharedMeetingMap({ members, areas, frameRequest, draft = null }: {
  members: SharedMemberStatus[];
  areas: { regions: IsochroneRegion[] }[];
  frameRequest: number;
  draft?: StartingPoint | null;
}) {
  const map = useMap();
  const membersRef = useRef(members);
  membersRef.current = members;
  useEffect(() => {
    if (!frameRequest) return;
    const points = membersRef.current.flatMap(member => member.at ? [[member.at.lat, member.at.lon] as [number, number]] : []);
    if (points.length) map.fitBounds(latLngBounds(points), { ...panelPadding(map), maxZoom: 14 });
  }, [map, frameRequest]);
  const groups = new Map<string, SharedMemberStatus[]>();
  for (const member of members) {
    if (!member.at) continue;
    const key = `${member.at.lat}:${member.at.lon}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  return <>
    {areas.flatMap((area, index) => area.regions.map((region, piece) => <Polygon
      key={`${index}-${piece}`}
      positions={[region.outer, ...region.holes].map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))}
      interactive={false}
      pathOptions={{ color: COLOURS[(members[index]?.colourSlot ?? index) % COLOURS.length], weight: 1, fillOpacity: 0.07 }}
    />))}
    {[...groups.entries()].map(([key, people]) => {
      const member = people[0];
      if (!member.at) return null;
      return <CircleMarker
      key={key} center={[member.at.lat, member.at.lon]} radius={9}
      bubblingMouseEvents={false}
      pathOptions={{ color: '#ffffff', weight: 2, fillColor: COLOURS[(member.colourSlot ?? 0) % COLOURS.length], fillOpacity: 1 }}
    ><Tooltip permanent direction="top" offset={[0, -14]}><span className="block w-max max-w-48 whitespace-normal text-center">{people.map(person => `${person.displayName}${person.isSelf ? ' (you)' : ''}`).join(' · ')}</span></Tooltip></CircleMarker>;
    })}
    {draft && !members.some(member => member.at?.lat === draft.at.lat && member.at.lon === draft.at.lon) && <CircleMarker center={[draft.at.lat, draft.at.lon]} radius={8} bubblingMouseEvents={false} pathOptions={{ color: '#fbbf24', fillOpacity: 0.15, dashArray: '3 3' }}><Tooltip permanent direction="top" offset={[0, -14]}>Preview · not shared</Tooltip></CircleMarker>}
  </>;
}
