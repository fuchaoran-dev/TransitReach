import { useEffect, useRef, useState } from 'react';
import { LocateFixed, X } from 'lucide-react';
import { LocationSearch } from '@/features/reachability';
import { hitName, originFromHit } from '@/features/reachability/reachabilityService';
import type { Participant, StartingPoint } from '../types';

interface Props {
  me: Participant | null;
  draft: StartingPoint | null;
  notice: string | null;
  busy?: boolean;
  onSelect: (point: StartingPoint) => void;
  onShare: () => void;
  onCancel: () => void;
  onWithdraw: () => void;
}

/** Selection/GPS previews locally. Only the Share button discloses the selected point. */
export function MyStartingPoint({ me, draft, notice, busy = false, onSelect, onShare, onCancel, onWithdraw }: Props) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A newer map/search preview invalidates an older pending GPS result.
  useEffect(() => { request.current++; setLocating(false); }, [draft, busy]);
  const select = (point: StartingPoint) => {
    request.current++;
    setLocating(false);
    setLocationError(null);
    onSelect(point);
  };
  const cancel = () => { request.current++; setLocating(false); setLocationError(null); onCancel(); };
  const locate = () => {
    if (busy || locating) return;
    if (!navigator.geolocation) { setLocationError('Location is not supported. Search or choose a map point.'); return; }
    const ticket = ++request.current;
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current || ticket !== request.current) return;
      select({ at: { lat: position.coords.latitude, lon: position.coords.longitude }, source: 'device', label: 'Current location' });
    }, error => {
      if (!mounted.current || ticket !== request.current) return;
      setLocating(false);
      setLocationError(error.code === 1 ? 'Location permission was denied. Select a point manually.' : 'Could not get your location. Try again or select a point manually.');
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };
  return <div className="space-y-3">
    <h2 className="text-sm font-bold text-slate-100">Your starting point</h2>
    <LocationSearch key={draft ? 'preview' : me?.at ? 'saved' : 'unset'} compact onSelect={hit => {
      const origin = originFromHit(hit);
      select({ at: origin.at, source: origin.source as StartingPoint['source'], label: hitName(hit) });
    }} />
    <button type="button" onClick={locate} disabled={locating || busy} className="btn-secondary flex w-full items-center justify-center gap-2 text-sm">
      <LocateFixed size={16} aria-hidden="true" />{locating ? 'Getting location…' : 'Use my current location'}
    </button>
    {locating && <button type="button" className="text-xs text-slate-300 underline" onClick={cancel}>Cancel location request</button>}
    {draft && <section className="rounded-xl border border-teal-300/40 bg-teal-300/5 p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs text-teal-200">Preview · not shared</p><p className="mt-1 break-words text-sm font-semibold">{draft.label ?? 'Selected map point'}</p></div>
        <button type="button" onClick={cancel} disabled={busy} aria-label="Cancel starting point preview" className="btn-icon shrink-0"><X size={14} /></button></div>
      <button type="button" disabled={busy || locating} onClick={onShare} className="btn-primary mt-3 w-full text-sm">{me?.at ? 'Share updated starting point' : 'Share starting point'}</button>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">Your group can see this point and your name. No live tracking.</p>
    </section>}
    {me?.at && <section className="rounded-xl border border-[#294456] bg-[#192a38] p-3">
      <p className="text-xs text-emerald-300">Shared with this room</p><p className="mt-1 break-words text-sm font-semibold">{me.label ?? 'Selected map point'}</p>
      <button type="button" disabled={busy} onClick={() => { cancel(); onWithdraw(); }} className="mt-2 text-xs text-slate-300 underline">Stop sharing</button>
    </section>}
    {!draft && !me?.at && <p className="text-xs leading-relaxed text-slate-400">Search or tap the map, then share to become Ready. A nearby station can protect your home address.</p>}
    {notice && <p role="alert" className="text-xs text-rose-300">{notice}</p>}
    {locationError && <p role="alert" className="text-xs text-rose-300">{locationError}</p>}
    {busy && <p role="status" className="text-xs text-slate-300">Saving room changes…</p>}
  </div>;
}
