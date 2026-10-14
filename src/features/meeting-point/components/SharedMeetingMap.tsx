import { useEffect, useRef } from 'react';
import { CircleMarker, Polygon, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import type { SharedMemberStatus } from '../types';
import { panelPadding } from '../mapFraming';

const COLOURS = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185'];

/** Only authenticated room projections supply these saved (not continuously tracked) points. */
export function SharedMeetingMap({ members, areas, frameRequest }: {
  members: SharedMemberStatus[];
  areas: { regions: IsochroneRegion[] }[];
  frameRequest: number;
}) {
  const map = useMap();
  const membersRef = useRef(members);
  membersRef.current = members;
  useEffect(() => {
    if (!frameRequest) return;
    const points = membersRef.current.flatMap(member => member.at ? [[member.at.lat, member.at.lon] as [number, number]] : []);
    if (points.length) map.fitBounds(latLngBounds(points), { ...panelPadding(map), maxZoom: 14 });
  }, [map, frameRequest]);
  return <>
    {areas.flatMap((area, index) => area.regions.map((region, piece) => <Polygon
      key={`${index}-${piece}`}
      positions={[region.outer, ...region.holes].map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))}
      interactive={false}
      pathOptions={{ color: COLOURS[(members[index]?.colourSlot ?? index) % COLOURS.length], weight: 1, fillOpacity: 0.07 }}
    />))}
    {members.map(member => member.at && <CircleMarker
      key={member.id} center={[member.at.lat, member.at.lon]} radius={member.isSelf ? 7 : 9}
      bubblingMouseEvents={false}
      pathOptions={{ color: '#ffffff', weight: 2, fillColor: COLOURS[(member.colourSlot ?? 0) % COLOURS.length], fillOpacity: 1 }}
    ><Tooltip permanent direction="top" offset={[0, -10]}>{member.displayName}{member.isSelf ? ' (you)' : ''}</Tooltip></CircleMarker>)}
  </>;
}
