import { X } from 'lucide-react';
import { LocationSearch } from '@/features/reachability';
import { formatCoord, hitName, originFromHit } from '@/features/reachability/reachabilityService';
import type { Participant, StartingPoint } from '../types';

interface MyStartingPointProps {
  me: Participant | null;
  /** A rejection to show, such as a point outside the covered area. */
  notice: string | null;
  onSearchSelect: (point: StartingPoint) => void;
  onClear: () => void;
}

/**
 * This device's own starting point. Nobody sets a point for anyone else: that is the
 * mentors' objection this epic's room design answers.
 *
 * No "Use my location" button. The point is shared with everyone in the room, so a GPS fix
 * would be broadcast to other people; search and map selection carry no such surprise.
 */
export function MyStartingPoint({ me, notice, onSearchSelect, onClear }: MyStartingPointProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-900">Your starting point</div>

      {/* Remounted when a point is set or cleared, so the field empties rather than keeping
          a typed name that no longer describes the point shown below it. */}
      <LocationSearch
        key={me?.at ? 'set' : 'unset'}
        compact
        onSelect={hit => {
          const origin = originFromHit(hit);
          onSearchSelect({
            at: origin.at,
            source: origin.source as StartingPoint['source'],
            label: hitName(hit),
          });
        }}
      />

      {me?.at ? (
        <div className="glass-chip rounded-xl px-3 py-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{me.label ?? 'Point on the map'}</div>
            <div className="text-xs text-slate-500 font-mono">{formatCoord(me.at)}</div>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear your starting point"
            className="btn-icon shrink-0"
            style={{ width: 28, height: 28 }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 leading-relaxed">
          Search by name, or tap the map. Everyone in the room sees the point you choose.
        </p>
      )}

      {notice && (
        <p role="alert" className="text-xs text-rose-600">
          {notice}
        </p>
      )}
    </div>
  );
}
