import type { Outcome, Suggestion } from '../hooks/useCommonGround';
import { participantName, type Participant } from '../types';

interface CommonGroundSummaryProps {
  /** Everyone in the room, in list order — used for names. */
  participants: Participant[];
  budgetMinutes: number;
  outcome: Outcome;
  suggestion: Suggestion | null;
  counted: Participant[];
  notCounted: Participant[];
  onUseBudget: (budgetMinutes: number) => void;
  onShowOnMap: () => void;
  onRetrySuggestion: () => void;
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The answer to the question the group opened the room for: is there somewhere we can all get
 * to? Stated in words beside the map, and never left for the reader to infer from whether a
 * grey shape happens to be visible.
 */
export function CommonGroundSummary({
  participants,
  budgetMinutes,
  outcome,
  suggestion,
  counted,
  notCounted,
  onUseBudget,
  onShowOnMap,
  onRetrySuggestion,
}: CommonGroundSummaryProps) {
  const nameOf = (participant: Participant) => participantName(participant, participants.indexOf(participant));
  const group = counted.length === 2 ? 'both of you' : `all ${counted.length} of you`;
  const Group = group.charAt(0).toUpperCase() + group.slice(1);

  return (
    <div className="glass-chip rounded-xl px-3 py-2.5 space-y-1.5">
      <div className="text-sm font-bold text-slate-900">Where you can all reach</div>

      {outcome.status === 'too-few' && (
        <p className="text-xs text-slate-600">
          Once two or more of you have set a starting point, the area you can all reach shows here.
        </p>
      )}

      {outcome.status === 'pending' && (
        <p role="status" className="text-xs text-slate-600">
          Working it out… waiting on {joinNames(outcome.waitingOn.map(nameOf))}.
        </p>
      )}

      {outcome.status === 'blocked' && (
        <p className="text-xs text-slate-600">
          This can't be shown until {joinNames(outcome.failed.map(nameOf))}'s area is worked out. Use Retry beside
          their name.
        </p>
      )}

      {outcome.status === 'error' && (
        <p className="text-xs text-rose-600">Something went wrong combining the areas. Try another budget.</p>
      )}

      {outcome.status === 'found' && (
        <>
          <p className="text-xs text-slate-700">
            {Group} can reach the shaded area within {budgetMinutes} min
            {outcome.polygons.length > 1 ? `, in ${outcome.polygons.length} separate places` : ''}.
          </p>
          <button type="button" onClick={onShowOnMap} className="text-xs font-semibold text-teal-700 hover:underline">
            Show on map
          </button>
        </>
      )}

      {outcome.status === 'none' && (
        <>
          <p className="text-xs text-slate-700">
            There's nowhere {group} can reach within {budgetMinutes} min.
          </p>
          {suggestion?.status === 'checking' && (
            <p role="status" className="text-xs text-slate-500">Checking longer travel times…</p>
          )}
          {suggestion?.status === 'found' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-700">You could all reach somewhere within {suggestion.budgetMinutes} min.</p>
              <button
                type="button"
                onClick={() => onUseBudget(suggestion.budgetMinutes)}
                className="btn-secondary text-xs py-1.5 px-2.5 shrink-0"
              >
                Use {suggestion.budgetMinutes} min
              </button>
            </div>
          )}
          {suggestion?.status === 'none-within-max' && (
            <p className="text-xs text-slate-600">
              Not even within {suggestion.maxMinutes} min, the longest travel time here. Someone may be starting too
              far from the others for one trip each.
            </p>
          )}
          {suggestion?.status === 'unavailable' && (
            <p className="text-xs text-slate-600">
              Couldn't check longer travel times just now.{' '}
              <button type="button" onClick={onRetrySuggestion} className="font-semibold text-teal-700 hover:underline">
                Try again
              </button>
            </p>
          )}
        </>
      )}

      {notCounted.length > 0 && outcome.status !== 'too-few' && (
        <p className="text-xs text-slate-500">
          {joinNames(notCounted.map(nameOf))} {notCounted.length === 1 ? "hasn't" : "haven't"} set a starting point, so{' '}
          {notCounted.length === 1 ? "isn't" : "aren't"} counted.
        </p>
      )}
    </div>
  );
}
