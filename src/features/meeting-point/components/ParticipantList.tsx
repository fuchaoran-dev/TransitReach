import { participantColour } from '../participantColours';
import { MAX_PARTICIPANTS, participantName, type Participant } from '../types';

interface ParticipantListProps {
  participants: Participant[];
  myUserId: string | null;
}

/** Also the map's legend: each name carries the swatch its marker and area are drawn in. */
export function ParticipantList({ participants, myUserId }: ParticipantListProps) {
  const mySlot = participants.find(participant => participant.userId === myUserId)?.colourSlot ?? null;

  return (
    <div>
      <h2 className="text-sm font-bold text-slate-900">
        People ({participants.length} of {MAX_PARTICIPANTS})
      </h2>
      <ul className="mt-2 space-y-1.5">
        {participants.map((participant, index) => (
          <li key={participant.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-slate-900 whitespace-nowrap">
              <span
                aria-hidden="true"
                className="w-2.5 h-2.5 rounded-full shrink-0 self-center ring-2 ring-white"
                style={{ background: participantColour(participant, mySlot) }}
              />
              {participantName(participant, index)}
              {participant.userId === myUserId && (
                <span className="text-xs font-semibold text-teal-700">You</span>
              )}
            </span>
            <span className="text-slate-500 truncate">
              {participant.at ? participant.label ?? 'Point on the map' : 'No starting point yet'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
