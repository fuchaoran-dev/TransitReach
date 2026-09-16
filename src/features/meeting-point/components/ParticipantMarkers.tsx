import { CircleMarker, Tooltip } from 'react-leaflet';
import { participantColour } from '../participantColours';
import { participantName, type Participant } from '../types';

interface ParticipantMarkersProps {
  participants: Participant[];
  myUserId: string | null;
}

/**
 * Everyone else's starting point.
 *
 * The viewer's own point is drawn by BaseMap as the origin pin, so the one shape on the map
 * that means "you" keeps that meaning (AC 1.3.4); everyone else is a disc.
 *
 * Every disc carries its person's name permanently. Six colours cannot be told apart on every
 * pair by every reader (see participantColours.ts), so the label is what identifies a person
 * and the colour ties a marker to its entry in the list.
 */
export function ParticipantMarkers({ participants, myUserId }: ParticipantMarkersProps) {
  const mySlot = participants.find(participant => participant.userId === myUserId)?.colourSlot ?? null;

  return (
    <>
      {participants.map((participant, index) => {
        if (!participant.at || participant.userId === myUserId) return null;
        return (
          <CircleMarker
            key={participant.id}
            center={[participant.at.lat, participant.at.lon]}
            radius={9}
            pane="markerPane"
            // Not interactive, so a tap on someone's marker reaches the map like any other tap.
            interactive={false}
            pathOptions={{
              color: '#ffffff',
              weight: 3,
              fillColor: participantColour(participant, mySlot),
              fillOpacity: 1,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {participantName(participant, index)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
