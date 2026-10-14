import type { ReactNode } from 'react';
import { Accessibility, ArrowRight, Check, Clock, MapPin, Plus, Route, X } from 'lucide-react';
import { CATEGORY_META } from '@/shared/data';
import type { ServiceLocation } from '@/shared/types/service';

/** Epic 2 — lets a place being inspected become a stop in the multi-stop outing. */
export interface OutingControls {
  stopIds: string[];
  /** True when the outing holds as many stops as the Trip Planner compares. */
  full: boolean;
  onAdd: (service: ServiceLocation) => void;
  onRemove: (id: string) => void;
  onOpenPlanner?: () => void;
}

/** AC 5.1.3 / 5.2.4 — show the source-backed detail and identify unavailable fields. */
export function ServiceDetail({
  service,
  onJourney,
  onClear,
  outing,
  departureRecommendation,
}: {
  service: ServiceLocation;
  onJourney?: (service: ServiceLocation) => void;
  onClear?: () => void;
  outing?: OutingControls;
  departureRecommendation?: ReactNode;
}) {
  const meta = CATEGORY_META[service.category];
  const Icon = meta.icon;
  const inOuting = outing?.stopIds.includes(service.id) ?? false;
  return (
    <div className="glass service-detail-panel p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="service-category-icon w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: meta.colorLight, borderColor: meta.color }}><Icon size={25} color="#102a43" strokeWidth={2.5} aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="service-category-label text-xs font-semibold uppercase tracking-wide">{meta.label}</div>
          <div className="font-bold text-slate-900">{service.name}</div>
        </div>
        {onClear && <button type="button" onClick={onClear} aria-label="Clear selected service" title="Clear selected service" className="service-detail-clear"><X size={18} /></button>}
      </div>
      <div className="text-sm">
        <div className="glass-chip p-2"><span className="text-xs text-slate-500">Estimated travel</span><div className="font-semibold mt-1" role="status">{service.estimatedTravelTime === undefined ? 'Calculating…' : service.estimatedTravelTime === null ? 'Unavailable' : `${service.estimatedTravelTime} min`}</div></div>
      </div>
      {service.address && <div className="text-sm text-slate-600"><MapPin size={14} className="inline mr-1 text-teal-600" />{service.address}</div>}
      <div className="arrival-availability text-sm"><strong>{service.arrivalAvailability?.status ?? 'Unknown'} at estimated arrival</strong>{service.arrivalAvailability?.arrival && <div>{new Date(service.arrivalAvailability.arrival).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} MYT</div>}</div>
      <details className="planning-disclosure"><summary>Place & data details</summary>
      <div className="text-xs text-slate-500 mt-2">Coordinates: {service.lat?.toFixed(5) ?? 'Unavailable'}, {service.lon?.toFixed(5) ?? 'Unavailable'}</div>
      {!service.address && <p>Address unavailable</p>}
      <div className="text-xs text-slate-500"><Clock size={14} className="inline mr-1" />{service.hours || 'Opening hours unavailable'}</div>
      <p>{service.arrivalAvailability?.reason ?? 'Arrival estimate or opening-hour information unavailable.'}</p>
      <div className="text-xs text-slate-500">Source tag: <span className="font-mono">{service.sourceCategory || 'Unavailable'}</span></div>
      <div className="text-xs text-slate-500 flex items-center gap-1"><Accessibility size={13} />{service.accessible === undefined ? 'Wheelchair information unavailable' : service.accessible ? 'Wheelchair accessible' : 'Wheelchair access marked no'}</div>
      </details>

      {departureRecommendation}
      {onJourney && (
        <button
          type="button"
          onClick={() => onJourney(service)}
          className="w-full rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 flex items-center justify-center gap-2"
        >
          <Route size={16} />
          View journey
          <ArrowRight size={15} />
        </button>
      )}

      {outing && (
        <div className="space-y-2">
          {inOuting ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-teal-700"><Check size={15} aria-hidden="true" />In your outing</span>
              <button type="button" onClick={() => outing.onRemove(service.id)} className="btn-secondary text-xs py-1.5 px-2.5">Remove</button>
            </div>
          ) : outing.full ? (
            <p className="text-xs text-slate-500">Your outing already has {outing.stopIds.length} stops. Remove one to add this place.</p>
          ) : (
            <button type="button" onClick={() => outing.onAdd(service)} className="btn-secondary w-full inline-flex items-center justify-center gap-2 text-sm">
              <Plus size={16} aria-hidden="true" />
              Add to outing
            </button>
          )}
          {outing.onOpenPlanner && outing.stopIds.length > 0 && (
            <button type="button" onClick={outing.onOpenPlanner} className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-teal-700">
              Plan outing · {outing.stopIds.length} {outing.stopIds.length === 1 ? 'stop' : 'stops'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
