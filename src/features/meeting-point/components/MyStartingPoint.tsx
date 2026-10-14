import { useEffect, useRef, useState } from 'react';
import { LocateFixed, X } from 'lucide-react';
import { LocationSearch } from '@/features/reachability';
import { formatCoord, hitName, originFromHit } from '@/features/reachability/reachabilityService';
import type { Participant, StartingPoint } from '../types';

interface MyStartingPointProps {
  me: Participant | null;
  /** A rejection to show, such as a point outside the covered area. */
  notice: string | null;
  onSearchSelect: (point: StartingPoint) => void;
  onClear: () => void;
  busy?: boolean;
  sharingAllowed: boolean;
  onSharingChange: (value: boolean) => void;
}

/**
 * This device's own starting point. Nobody sets a point for anyone else: that is the
 * mentors' objection this epic's room design answers.
 *
 * Explicit consent precedes sharing. Device location is requested only on click,
 * captured once and saved just like a search or map point, never watched in the background.
 */
export function MyStartingPoint({ me, notice, onSearchSelect, onClear, busy = false, sharingAllowed: share, onSharingChange }: MyStartingPointProps) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const select = (point: StartingPoint) => {
    if (!share) { setLocationError('Allow room members to see this starting point before saving it.'); return; }
    setLocationError(null);
    onSearchSelect(point);
  };
  const locate = () => {
    if (!share || busy || locating) return;
    if (!navigator.geolocation) { setLocationError('Location is not supported. Search or choose a point on the map.'); return; }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      setLocating(false);
      select({ at: { lat: position.coords.latitude, lon: position.coords.longitude }, source: 'device', label: 'Current location' });
    }, error => {
      if (!mounted.current) return;
      setLocating(false);
      setLocationError(error.code === 1 ? 'Location permission was denied. Search or choose a point on the map.' : 'Could not get your location. Try again or select a point manually.');
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-100">Your starting point</div>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-300">
        <input type="checkbox" checked={share} disabled={busy} onChange={event => onSharingChange(event.target.checked)} className="mt-0.5 accent-teal-400" />
        Share my selected starting point and name with room members. Unchecking clears the saved point. This is not live tracking.
      </label>

      {/* Remounted when a point is set or cleared, so the field empties rather than keeping
          a typed name that no longer describes the point shown below it. */}
      <LocationSearch
        key={me?.at ? 'set' : 'unset'}
        compact
        onSelect={hit => {
          const origin = originFromHit(hit);
          select({
            at: origin.at,
            source: origin.source as StartingPoint['source'],
            label: hitName(hit),
          });
        }}
      />
      <button type="button" onClick={locate} disabled={!share || locating || busy} className="btn-secondary flex w-full items-center justify-center gap-2 text-sm">
        <LocateFixed size={16} aria-hidden="true" />{locating ? 'Getting location…' : 'Use my current location'}
      </button>

      {me?.at ? (
        <div className="glass-chip rounded-xl px-3 py-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{me.label ?? 'Point on the map'}</div>
            <div className="text-xs text-slate-500 font-mono">{formatCoord(me.at)}</div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            aria-label="Clear your starting point"
            className="btn-icon shrink-0"
            style={{ width: 28, height: 28 }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 leading-relaxed">
          Search by name or use your current location. You can select a nearby station instead of sharing your home.
        </p>
      )}

      {notice && (
        <p role="alert" className="text-xs text-rose-600">
          {notice}
        </p>
      )}
      {locationError && <p role="alert" className="text-xs text-rose-300">{locationError}</p>}
      {busy && <p role="status" className="text-xs text-slate-300">Saving room changes…</p>}
    </div>
  );
}
