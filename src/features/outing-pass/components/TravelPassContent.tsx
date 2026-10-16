import { useState } from 'react';
import { CheckCircle2, Clock, Download, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import type { JourneyOptionSummary, PersonalPass } from '../types';
import { downloadPassImage } from '../passExport';
import { isPastMeeting, passDate, passTime } from './passPresentation';
import { usePassClock } from '../hooks/usePassClock';
import { countdownLabel, minutesLabel } from './legPresentation';
import { JourneyTimeline } from './JourneyTimeline';
import { PrivateJourneyMap } from './PrivateJourneyMap';
import { RouteOptionCards } from './RouteOptionCards';

function ArrivalFit({ arrival, meeting }: { arrival: string; meeting: string }) {
  const spare = Math.round((Date.parse(meeting) - Date.parse(arrival)) / 1000);
  if (!Number.isFinite(spare)) return null;
  const early = spare >= 0;
  return <p className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${early ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
    {early ? <CheckCircle2 size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
    <span>
      Arrive <strong className="tabular-nums">{passTime(arrival)}</strong> ·{' '}
      {early
        ? spare < 60 ? 'right on time for' : `${minutesLabel(spare)} before`
        : `${minutesLabel(-spare)} after`} the <span className="tabular-nums">{passTime(meeting)}</span> meet-up
    </span>
  </p>;
}

interface ContentProps {
  pass: PersonalPass;
  originLabel: string;
}

type Props = ContentProps & (
  | { mode: 'saved' }
  | { mode?: 'live'; options: JourneyOptionSummary[]; onSelectJourney: (id: string) => void; onRecheck: () => void }
);

/** Saved passes share the journey presentation, with no route mutation actions. */
export function TravelPassContent(props: Props) {
  const { pass, originLabel } = props;
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const now = usePassClock();
  const historical = isPastMeeting(pass.meeting.arrivalTime, now);
  return <div className="travel-pass-ready grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
    <section className={`travel-pass-sheet order-2 min-w-0 space-y-6 lg:order-1 ${expanded ? 'is-expanded' : ''}`}>
      <button type="button" className="travel-pass-sheet-toggle" aria-expanded={expanded} aria-controls="travel-pass-details" onClick={() => setExpanded(value => !value)}><span aria-hidden="true" /><span>{expanded ? 'More map · collapse journey' : 'Journey details · expand'}</span></button>
      {props.mode === 'saved' && <div className="rounded-xl border border-slate-600/60 bg-slate-800/50 p-3 text-sm text-slate-300">
        <p className="font-semibold text-slate-100">{historical ? 'Historical journey' : 'Saved journey'}</p>
        <p className="mt-1">Saved {passDate(pass.checkedAt)} · <span className="tabular-nums">{passTime(pass.checkedAt)}</span> MYT.</p>
        <p className="mt-1 text-xs">Route not updated live. To plan again, open Meet and generate a new pass.</p>
      </div>}
      <div id="travel-pass-details" className="rounded-2xl border border-teal-300/30 bg-gradient-to-br from-teal-300/10 to-transparent p-5">
        {pass.zeroTravel
          ? <><p className="text-xs font-semibold uppercase tracking-wider text-teal-200">Starting point matches the meeting point</p><h2 className="mt-2 text-3xl font-extrabold">No travel needed</h2></>
          : <>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-200"><Clock size={14} aria-hidden="true" />{historical ? 'Past meeting · saved schedule' : countdownLabel(pass.leaveTime, now)}</p>
            <h2 className="mt-2 text-3xl font-extrabold md:text-4xl">{historical ? 'Planned departure' : 'Leave around'} <span className="block whitespace-nowrap tabular-nums text-teal-200 sm:inline">{passTime(pass.leaveTime)}</span></h2>
            <p className="mt-1 text-sm text-slate-300">from {originLabel} · {minutesLabel(Date.parse(pass.estimatedArrivalTime) / 1000 - Date.parse(pass.leaveTime) / 1000)} door to door</p>
            <ArrivalFit arrival={pass.estimatedArrivalTime} meeting={pass.meeting.arrivalTime} />
          </>}
      </div>
      {props.mode !== 'saved' && props.options.length > 1 && <RouteOptionCards options={props.options} selectedId={pass.selectedJourneyId} onSelect={props.onSelectJourney} />}
      {!pass.zeroTravel && <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Your journey</h2>
        <JourneyTimeline legs={pass.legs} originLabel={originLabel} destinationLabel={pass.meeting.venue.name} />
      </div>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={downloading} aria-busy={downloading} className="btn-primary flex items-center gap-2" onClick={() => {
          setDownloading(true); setExportError(null);
          void downloadPassImage(pass).catch(() => setExportError('The image could not be downloaded. Try again.')).finally(() => setDownloading(false));
        }}><Download size={16} aria-hidden="true" />{downloading ? 'Preparing image…' : 'Download pass'}</button>
        {props.mode !== 'saved' && <button type="button" className="btn-secondary flex items-center gap-2" onClick={props.onRecheck}><RefreshCw size={16} aria-hidden="true" />Refresh route</button>}
      </div>
      {exportError && <p role="alert" className="text-sm text-rose-300">{exportError}</p>}
      <details className="travel-steps text-xs text-slate-400">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 hover:text-slate-200"><Info size={14} aria-hidden="true" />About these times · saved in My Passes on this device</summary>
        <p className="mt-2 leading-relaxed">OSM/GTFS estimates, not guaranteed departures. Delay, weather and opening-hours checks are not run. This route is private and does not change anyone’s Ready status.</p>
      </details>
    </section>
    <div className="travel-pass-map-column order-1 min-w-0 lg:order-2"><div className="travel-pass-map-wrap"><PrivateJourneyMap pass={pass} sheetCoverage={expanded ? 0.64 : 0.35} /></div></div>
  </div>;
}
