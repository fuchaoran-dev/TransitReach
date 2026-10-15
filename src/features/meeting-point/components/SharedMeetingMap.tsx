import { useEffect, useRef } from 'react';
import { CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { SharedMemberStatus, StartingPoint } from '../types';
import { panelPadding } from '../mapFraming';
import { meetingMapWaypoints } from '../meetingMapWaypoints';

/** Only authenticated room projections supply these saved (not continuously tracked) points. */
export function SharedMeetingMap({ members, frameRequest, draft = null }: {
  members: SharedMemberStatus[];
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
  return <>
    {meetingMapWaypoints(members).map(point => <CircleMarker
      key={`${point.lat}:${point.lon}`} center={[point.lat, point.lon]} radius={9}
      bubblingMouseEvents={false}
      pathOptions={{ color: '#ffffff', weight: 2, fillColor: point.colour, fillOpacity: 1 }}
    ><Tooltip permanent direction="top" offset={[0, -14]}><span className="block w-max max-w-48 whitespace-normal text-center">{point.label}</span></Tooltip></CircleMarker>)}
    {draft && !members.some(member => member.at?.lat === draft.at.lat && member.at.lon === draft.at.lon) && <CircleMarker center={[draft.at.lat, draft.at.lon]} radius={8} bubblingMouseEvents={false} pathOptions={{ color: '#fbbf24', fillOpacity: 0.15, dashArray: '3 3' }}><Tooltip permanent direction="top" offset={[0, -14]}>Preview · not shared</Tooltip></CircleMarker>}
  </>;
}
