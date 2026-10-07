import { AlertTriangle, ArrowLeft, CloudRain, Download, Footprints, RefreshCw, ShieldCheck, Store, TrainFront } from 'lucide-react';
import { describeStep } from '@/features/interchange/interchangeService';
import type { JourneyOptionSummary, PersonalPass } from '../types';
import { ArrivalBadge } from './GroupStatus';
import { marginLabel, passDate, passTime } from './passPresentation';

interface Props {
  pass: PersonalPass;
  options: JourneyOptionSummary[];
  busy: boolean;
  onRecheck: () => void;
  onSelectJourney: (id: string) => void;
  onLeaveEarlier: () => void;
  onDownload: () => void;
  onSuggestTime: () => void;
  onBack: () => void;
}

export function PersonalPassView({ pass, options, busy, onRecheck, onSelectJourney, onLeaveEarlier, onDownload, onSuggestTime, onBack }: Props) {
  return (
    <div className="space-y-5">
      <button className="flex items-center gap-2 outing-muted text-sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to invitation</button>
      <header className="flex flex-wrap justify-between items-start gap-3"><div><h1 className="text-2xl md:text-3xl font-bold break-words">{pass.meeting.venue.name} · Plan v{pass.planVersion}</h1><p className="outing-muted text-sm mt-2">Your personal pass · {passDate(pass.meeting.arrivalTime)}</p></div><ArrivalBadge status={pass.status} /></header>
      <section className="outing-card space-y-4">
        <p className="outing-muted text-xs uppercase tracking-widest font-bold">Recommended start · MYT</p>
        <h2 className="text-3xl font-bold outing-accent">Leave around {passTime(pass.leaveTime)}</h2>
        <p className="outing-muted text-sm">Modelled journey with supported typical delays carried forward. Times are estimates.</p>
        <div className="outing-card-inset grid grid-cols-3 gap-3 text-center text-sm"><div><p className="outing-muted text-xs">Estimated arrival</p><p className="font-bold mt-1">Around {passTime(pass.estimatedArrivalTime)}</p></div><div><p className="outing-muted text-xs">Agreed meeting</p><p className="font-bold mt-1">{passTime(pass.meeting.arrivalTime)}</p></div><div><p className="outing-muted text-xs">Arrival margin</p><p className="font-bold outing-accent mt-1">{marginLabel(pass.arrivalMarginSeconds)}</p></div></div>
      </section>
      <section aria-labelledby="pass-route-title" className="space-y-3"><h2 id="pass-route-title" className="text-sm font-bold uppercase tracking-wider">Your journey · {pass.legs.length} segments</h2>
        {pass.legs.map(leg => <article key={leg.id} className="outing-card-inset space-y-3">
          <div className="flex justify-between items-start gap-3"><h3 className="font-bold text-lg flex items-start gap-2">{leg.mode === 'WALK' ? <Footprints size={20} className="shrink-0 mt-1" aria-hidden="true" /> : <TrainFront size={20} className="shrink-0 mt-1" aria-hidden="true" />}{leg.mode === 'WALK' ? 'Walk' : leg.routeLongName ?? leg.routeShortName ?? leg.mode}</h3>
            {leg.delay?.status === 'checked' ? <span className="outing-badge outing-badge-attention">Typical +{Math.ceil(leg.delay.seconds / 60)} min</span> : leg.mode !== 'WALK' && <span className="outing-badge">Not checked</span>}
          </div>
          <p className="text-sm outing-muted">{leg.from.name} → {leg.to.name}</p><p className="text-xs outing-muted">Around {passTime(leg.estimatedStartTime)} – {passTime(leg.estimatedEndTime)} · {Math.ceil(leg.durationSeconds / 60)} min · {Math.round(leg.distanceMeters)} m</p>
          {leg.delay?.status === 'not-checked' && <p className="text-xs outing-muted">Delay not checked: {leg.delay.reason.replace(/-/g, ' ')}.</p>}
          {leg.delay?.status === 'checked' && <details className="text-xs outing-muted"><summary className="cursor-pointer">Delay evidence</summary><p className="mt-2">{leg.delay.source} · {leg.delay.sampleCount} observations · Model {leg.delay.modelVersion}</p><p className="mt-1">{leg.delay.disclaimer}</p></details>}
          {leg.steps.length > 0 && <details className="text-sm"><summary className="cursor-pointer outing-accent">Walking directions</summary><ol className="mt-3 space-y-2 list-decimal pl-5">{leg.steps.map((step, index) => <li key={index}>{describeStep(step)} · {Math.round(step.distanceMeters)} m</li>)}</ol></details>}
        </article>)}
      </section>
      {pass.connections.length > 0 && <section className="outing-card-inset"><h2 className="font-bold mb-3">Connection spare time</h2><ul className="space-y-3">{pass.connections.map(connection => <li key={connection.id} className="text-sm flex flex-wrap justify-between gap-2"><span>{connection.atName}</span><span className="outing-accent">{marginLabel(connection.spareSeconds)}</span></li>)}</ul></section>}
      <section className="outing-warning"><h2 className="flex items-center gap-2 text-xl font-bold"><AlertTriangle size={22} aria-hidden="true" />Plan weak point</h2><p className="mt-3 text-sm leading-relaxed">{pass.weakPoint.label}</p></section>
      <div className="grid sm:grid-cols-2 gap-4">
        <section className="outing-card-inset"><h2 className="font-bold flex items-center gap-2"><CloudRain size={18} aria-hidden="true" />Walking weather</h2><p className="mt-3 text-sm">{Math.ceil(pass.walking.totalSeconds / 60)} min total walking</p><WeatherDetails pass={pass} /></section>
        <section className="outing-card-inset"><h2 className="font-bold flex items-center gap-2"><Store size={18} aria-hidden="true" />Destination hours</h2>{pass.closingMargin.status === 'checked' ? <><p className="mt-3 text-sm">Closes at {passTime(pass.closingMargin.closesAt)} · {marginLabel(pass.closingMargin.marginSeconds)}</p><p className="outing-muted text-xs mt-2">{pass.closingMargin.source}</p></> : pass.closingMargin.status === 'always-open' ? <><p className="mt-3 text-sm outing-accent">Open 24 hours · No closing-time constraint</p><p className="outing-muted text-xs mt-2">{pass.closingMargin.source}</p></> : <p className="mt-3 text-sm outing-muted">Hours unknown · {pass.closingMargin.reason.replace(/-/g, ' ')}</p>}</section>
      </div>
      <section className="outing-card space-y-4"><h2 className="font-bold">Adjust your personal journey</h2><p className="text-sm outing-muted">These actions recalculate your journey and preserve the agreed meeting.</p><button className="btn-secondary w-full" disabled={busy} onClick={onLeaveEarlier}>Aim to arrive 10 minutes earlier</button>
        {options.length > 1 && <label className="block text-sm">Choose another journey<select className="glass-input w-full p-3 mt-2" value={pass.selectedJourneyId} disabled={busy} onChange={event => onSelectJourney(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>Around {passTime(option.leaveTime)} · {Math.ceil(option.durationSeconds / 60)} min · {option.transferCount} transfers · {option.status}</option>)}</select></label>}
        <button className="btn-secondary w-full" onClick={onSuggestTime}>Suggest another meeting time</button>
      </section>
      <div className="grid grid-cols-2 gap-3"><button className="btn-primary flex items-center justify-center gap-2" disabled={busy} onClick={onDownload}><Download size={18} aria-hidden="true" />Download image</button><button className="btn-secondary flex items-center justify-center gap-2" disabled={busy} onClick={onRecheck}><RefreshCw size={18} aria-hidden="true" />Re-check</button></div>
      <p className="outing-muted text-xs flex items-start gap-2 leading-relaxed"><ShieldCheck size={15} className="shrink-0" aria-hidden="true" />Private pass · checked {passTime(pass.checkedAt)} MYT. A saved or downloaded pass is a planning aid. Reopen before travelling to check the latest agreement and evidence.</p>
    </div>
  );
}

function WeatherDetails({ pass }: { pass: PersonalPass }) {
  const periods = Array.isArray(pass.weather) ? pass.weather : [pass.weather];
  return <div className="space-y-3 mt-3">{periods.map((weather, index) => weather.status === 'checked' ? <div key={index}><p className="text-sm">{weather.period}: {weather.summary}</p><p className="text-xs outing-muted mt-2">{Math.ceil(weather.walkingSecondsInPeriod / 60)} min walking in this period · {weather.location}</p><a className="outing-accent text-xs underline" href={weather.sourceUrl} target="_blank" rel="noreferrer">{weather.source}</a><p className="text-xs outing-muted">Retrieved {passDate(weather.retrievedAt)} · {passTime(weather.retrievedAt)}</p></div> : <p key={index} className="text-sm outing-muted">Weather unknown · {weather.reason.replace(/-/g, ' ')}</p>)}</div>;
}
