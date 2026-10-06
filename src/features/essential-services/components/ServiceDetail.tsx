import { Accessibility, ArrowRight, Clock, MapPin, Route, X } from 'lucide-react';
import { CATEGORY_META } from '@/shared/data';
import type { ServiceLocation } from '@/shared/types/service';

/** AC 5.1.3 / 5.2.4 — show the source-backed detail and identify unavailable fields. */
export function ServiceDetail({
  service,
  onJourney,
  onClear,
}: {
  service: ServiceLocation;
  onJourney?: (service: ServiceLocation) => void;
  onClear?: () => void;
}) {
  const meta = CATEGORY_META[service.category];
  const Icon = meta.icon;
  return (
    <div className="glass p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: meta.colorLight }}><Icon size={21} style={{ color: meta.color }} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</div>
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
    </div>
  );
}
