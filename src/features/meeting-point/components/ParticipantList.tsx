import type { AreaState } from '../hooks/useParticipantAreas';
import { participantColour } from '../participantColours';
import { MAX_PARTICIPANTS, participantName, type Participant } from '../types';

interface ParticipantListProps {
  participants: Participant[];
  myUserId: string | null;
  budgetMinutes: number;
  areaFor: (participant: Participant) => AreaState | null;
  focusedId: string | null;
  onFocus: (participantId: string | null) => void;
  onRetry: (participant: Participant) => void;
  onShowEveryone: () => void;
}

/**
 * The people in the room, and the map's legend.
 *
 * Each name carries the swatch its marker and area are drawn in, and the state of that
 * person's area. An area can take seconds or fail on its own — the shared routing engine is
 * slow under load — so the list says whose is still coming and whose needs a retry, rather
 * than the map simply missing a shape with no explanation.
 */
export function ParticipantList({
  participants,
  myUserId,
  budgetMinutes,
  areaFor,
  focusedId,
  onFocus,
  onRetry,
  onShowEveryone,
}: ParticipantListProps) {
  const mySlot = participants.find(participant => participant.userId === myUserId)?.colourSlot ?? null;
  const located = participants.filter(participant => participant.at).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">
          People ({participants.length} of {MAX_PARTICIPANTS})
        </h2>
        {located >= 2 && (
          <button type="button" onClick={onShowEveryone} className="text-xs font-semibold text-teal-700 hover:underline">
            Show everyone
          </button>
        )}
      </div>
      {located >= 2 && <p className="text-xs text-slate-500 mt-0.5">Tap a person to pick out their area.</p>}

      <ul className="mt-2 space-y-1">
        {participants.map((participant, index) => {
          const focused = participant.id === focusedId;
          return (
            <li key={participant.id} className={`rounded-lg px-2 py-1.5 -mx-2 ${focused ? 'bg-slate-100' : ''}`}>
              <button
                type="button"
                aria-pressed={focused}
                disabled={!participant.at}
                onClick={() => onFocus(focused ? null : participant.id)}
                className="w-full flex items-baseline justify-between gap-3 text-sm text-left disabled:cursor-default"
              >
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
              </button>
              <AreaStatus
                area={areaFor(participant)}
                budgetMinutes={budgetMinutes}
                onRetry={() => onRetry(participant)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Nothing for a normal finished area: the shape on the map says it. */
function AreaStatus({ area, budgetMinutes, onRetry }: {
  area: AreaState | null;
  budgetMinutes: number;
  onRetry: () => void;
}) {
  if (!area || (area.status === 'ready' && !area.walkingOnly)) return null;

  if (area.status === 'computing') {
    return <p role="status" className="text-xs text-slate-500 mt-0.5 pl-[18px]">Working out reachable area…</p>;
  }

  // A valid finding, not a failure: styled as information, with no retry.
  if (area.status === 'ready') {
    return (
      <p className="text-xs text-slate-600 mt-0.5 pl-[18px]">
        Walking only: no public transport can be boarded within {budgetMinutes} min
      </p>
    );
  }

  const message = area.status === 'timedout'
    ? `Took longer than ${Math.round(area.limitMs / 1000)} s to work out`
    : 'Could not work out the reachable area';

  return (
    <div className="flex items-center gap-2 text-xs mt-0.5 pl-[18px]">
      <span className="text-rose-600">{message}</span>
      <button type="button" onClick={onRetry} className="font-semibold text-teal-700 hover:underline">
        Retry
      </button>
    </div>
  );
}
