import { Accessibility, Clock, MapPin } from 'lucide-react';
import { CATEGORY_META } from '@/shared/data';
import type { ServiceLocation } from '@/shared/types/service';

/** AC 5.1.3 / 5.2.4 — show the source-backed detail and identify unavailable fields. */
export function ServiceDetail({ service }: { service: ServiceLocation }) {
  const meta = CATEGORY_META[service.category];
  const Icon = meta.icon;
  return (
    <div className="glass p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: meta.colorLight }}><Icon size={21} style={{ color: meta.color }} /></div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</div>
          <div className="font-bold text-slate-900">{service.name}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="glass-chip p-2"><span className="text-xs text-slate-500">Location</span><div className="font-mono text-xs mt-1">{service.lat?.toFixed(5) ?? 'Unavailable'}, {service.lon?.toFixed(5) ?? 'Unavailable'}</div></div>
        <div className="glass-chip p-2"><span className="text-xs text-slate-500">Estimated travel</span><div className="font-semibold mt-1">{service.estimatedTravelTime == null ? 'Unavailable' : `${service.estimatedTravelTime} min`}</div></div>
      </div>
      <div className="text-sm text-slate-600"><MapPin size={14} className="inline mr-1 text-teal-600" />{service.address || 'Address unavailable'}</div>
      <div className="text-sm text-slate-600"><Clock size={14} className="inline mr-1 text-teal-600" />{service.hours || 'Opening hours unavailable'}</div>
      <div className="text-xs text-slate-500">Source tag: <span className="font-mono">{service.sourceCategory || 'Unavailable'}</span></div>
      <div className="text-xs text-slate-500 flex items-center gap-1"><Accessibility size={13} />{service.accessible === undefined ? 'Wheelchair information unavailable' : service.accessible ? 'Wheelchair accessible' : 'Wheelchair access marked no'}</div>
      {service.missingFields && service.missingFields.length > 0 && <div className="text-xs text-amber-700">Unavailable fields: {service.missingFields.join(', ')}</div>}
    </div>
  );
}
