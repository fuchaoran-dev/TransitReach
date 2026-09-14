import { Polygon } from 'react-leaflet';
import type { AreaState } from '../hooks/useParticipantAreas';
import { participantColour } from '../participantColours';
import type { Participant } from '../types';

interface ParticipantAreasLayerProps {
  participants: Participant[];
  myUserId: string | null;
  areaFor: (participant: Participant) => AreaState | null;
  /** The participant whose area is picked out, or null for none. */
  focusedId: string | null;
}

/**
 * Each participant's reachable area, in their colour.
 *
 * Fills stay faint, so that where areas stack the stacking itself shows — the common ground
 * is what the group is looking for. With up to six areas on one map, colour alone soon stops
 * telling you whose shape is whose, so focusing a person from the list lifts their area and
 * fades everyone else's.
 *
 * Drawn in order others, then the viewer, then the focused person, so the outline that matters
 * most is never buried. Regions stay separate and holes stay holes, as on the reachability map.
 */
export function ParticipantAreasLayer({ participants, myUserId, areaFor, focusedId }: ParticipantAreasLayerProps) {
  const mySlot = participants.find(participant => participant.userId === myUserId)?.colourSlot ?? null;
  const rank = (participant: Participant) =>
    participant.id === focusedId ? 2 : participant.userId === myUserId ? 1 : 0;
  const ordered = [...participants].sort((a, b) => rank(a) - rank(b));

  return (
    <>
      {ordered.flatMap(participant => {
        const area = areaFor(participant);
        if (area?.status !== 'ready') return [];

        const colour = participantColour(participant, mySlot);
        const focused = participant.id === focusedId;
        const faded = focusedId !== null && !focused;

        return area.regions.map((region, index) => (
          <Polygon
            key={`${participant.id}-${index}`}
            // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
            positions={[region.outer, ...region.holes].map(ring =>
              ring.map(([lon, lat]) => [lat, lon] as [number, number]),
            )}
            interactive={false}
            pathOptions={{
              className: 'meeting-area',
              color: colour,
              weight: focused ? 3 : 2,
              // Faded, not gone: at 0.3 a thin outline vanished into the street map, and the
              // others' areas are still the context the picked-out one is read against.
              opacity: faded ? 0.5 : 0.9,
              fillColor: colour,
              fillOpacity: focused ? 0.25 : faded ? 0.03 : 0.1,
            }}
          />
        ));
      })}
    </>
  );
}
