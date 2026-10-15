import { Polygon } from 'react-leaflet';
import type { CommonGroundResult } from '../commonGroundService';
import { SHARED_MEMBER_COLOURS } from '../meetingMapWaypoints';
import type { SharedMemberStatus } from '../types';

/** Consent-gated individual reachability previews, keyed by the public room-member id. */
export function SharedParticipantAreasLayer({ areas, members }: {
  areas: CommonGroundResult['participantAreas'];
  members: SharedMemberStatus[];
}) {
  const memberById = new Map(members.map(member => [member.id, member]));

  return <>{areas.flatMap(area => {
    const member = area.memberId ? memberById.get(area.memberId) : null;
    if (!member) return [];
    const colour = SHARED_MEMBER_COLOURS[(member.colourSlot ?? 0) % SHARED_MEMBER_COLOURS.length];
    return area.regions.map((region, index) => <Polygon
      key={`${member.id}:${index}`}
      positions={[region.outer, ...region.holes].map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))}
      interactive={false}
      pathOptions={{
        className: 'meeting-member-area',
        color: colour,
        weight: 2,
        opacity: 0.72,
        fillColor: colour,
        fillOpacity: 0.07,
      }}
    />);
  })}</>;
}
