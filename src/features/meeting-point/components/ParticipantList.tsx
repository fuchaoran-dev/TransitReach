import { MAX_PARTICIPANTS, participantName, type Participant } from '../types';

interface ParticipantListProps {
  participants: Participant[];
  myUserId: string | null;
}

export function ParticipantList({ participants, myUserId }: ParticipantListProps) {
  return (
    <div>
      <h2 className="text-sm font-bold text-slate-900">
        People ({participants.length} of {MAX_PARTICIPANTS})
      </h2>
      <ul className="mt-2 space-y-1.5">
        {participants.map((participant, index) => (
          <li key={participant.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-slate-900 whitespace-nowrap">
              {participantName(participant, index)}
              {participant.userId === myUserId && (
                <span className="ml-1.5 text-xs font-semibold text-teal-700">You</span>
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
