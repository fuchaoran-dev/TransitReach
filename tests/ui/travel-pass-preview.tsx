/* eslint-disable react-refresh/only-export-components -- Standalone synthetic visual QA entry. */
// Explicitly synthetic, isolated UI preview. No room, origin or vote is saved.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft } from 'lucide-react';
import '@/index.css';
import { TravelPassContent } from '@/features/outing-pass/components/TravelPassContent';
import { SavedTravelPass } from '@/features/outing-pass/components/SavedTravelPass';
import { renderPassImage } from '@/features/outing-pass/passExport';
import type { CheckedPassLeg, PersonalPass } from '@/features/outing-pass/types';

const meetingTime = '2026-10-15T15:08:00+08:00';
const leaveTime = '2026-10-15T14:59:00+08:00';
const time = (minutes: number) => new Date(Date.parse(leaveTime) + minutes * 60_000).toISOString();
const names = ['Your starting point', 'SJ84 APARTMENT ANGSANA (SELATAN)', 'SJ628 Medan Selera USJ1/APARTMENT Meranti (Opp)', "McDonald's"];
const points = [{ lat: 3.0509, lon: 101.591 }, { lat: 3.0512, lon: 101.593 }, { lat: 3.043, lon: 101.596 }, { lat: 3.042, lon: 101.597 }];
const minutes = [0, 3, 5, 8];
const legs: CheckedPassLeg[] = points.slice(0, 3).map((point, index) => ({
  id: `leg-${index}`, mode: index === 1 ? 'BUS' : 'WALK', routeType: index === 1 ? 3 : null, stopCount: index === 1 ? 2 : null, transitLeg: index === 1,
  routeId: index === 1 ? 'fixture-bus' : null, routeShortName: index === 1 ? '770' : null,
  routeLongName: index === 1 ? 'Subang Mewah USJ 1 ~ Hab Pasar Seni' : null, routeColor: index === 1 ? '#007aff' : null,
  durationSeconds: (minutes[index + 1] - minutes[index]) * 60, distanceMeters: [280, 1400, 250][index],
  startTimeMs: Date.parse(time(minutes[index])), endTimeMs: Date.parse(time(minutes[index + 1])),
  estimatedStartTime: time(minutes[index]), estimatedEndTime: time(minutes[index + 1]),
  from: { ...point, name: names[index], stopId: null }, to: { ...points[index + 1], name: names[index + 1], stopId: null },
  geometry: [point, points[index + 1]], cumulativeDelaySeconds: 0, delay: null,
  steps: index === 1 ? [] : [{ relativeDirection: 'CONTINUE', streetName: index === 0 ? 'Persiaran Subang Indah' : 'Persiaran Subang Mewah', bogusName: false, distanceMeters: [280, 0, 250][index], ...point }],
}));
const pass: PersonalPass = {
  schemaVersion: 1, kind: 'group-outing', evidenceMode: 'route-only', id: 'synthetic-only', roomCode: 'ABCDEFGH', memberId: 'synthetic-only', planVersion: 1,
  checkedAt: new Date().toISOString(), routeTargetTime: meetingTime, selectedJourneyId: 'bus',
  meeting: { version: 1, arrivalTime: meetingTime, venue: { id: 'fixture-venue', type: 'restaurant', name: "McDonald's", kindLabel: 'Fast food', ...points[3] } },
  leaveTime, estimatedArrivalTime: time(8), arrivalMarginSeconds: 60, status: 'Not checked', legs, connections: [],
  walking: { totalSeconds: 360, totalDistanceMeters: 530, directions: legs.flatMap(leg => leg.steps.map(step => ({ ...step, legId: leg.id }))) },
  weather: [{ status: 'not-checked', reason: 'not-requested', label: 'Weather unknown' }],
  closingMargin: { status: 'not-checked', reason: 'not-requested', label: 'Hours unknown' },
  weakPoint: { kind: 'unchecked-delay', label: 'Synthetic route · No live evidence', marginSeconds: null },
};
function Preview() {
  const [selected, setSelected] = useState('bus');
  const [notice, setNotice] = useState('');
  const [image, setImage] = useState('');
  const [savedPass, setSavedPass] = useState<PersonalPass | null>(null);
  return <div className="transit-shell travel-pass-modal fixed inset-0 bg-[#080f18] p-3 md:p-6">
    <div className="travel-pass-scroll mx-auto h-full max-w-7xl overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]">
      <header className="travel-pass-header sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[#294456] bg-[#0e1c29] px-5 py-4">
        <ArrowLeft size={18} aria-hidden="true" /><div><h1 className="font-bold">Your travel pass</h1><p className="text-xs text-amber-200">Synthetic UI fixture · No live room or journey</p></div>
        <button className="btn-secondary ml-auto text-xs" onClick={() => void renderPassImage(pass).then(blob => setImage(URL.createObjectURL(blob)))}>Preview PNG</button>
        <button className="btn-secondary text-xs" onClick={() => setSavedPass(pass)}>View historical pass</button>
        <button className="btn-secondary text-xs" onClick={() => {
          const offset = Date.now() + 86_400_000 - Date.parse(pass.meeting.arrivalTime);
          const shift = (value: string) => new Date(Date.parse(value) + offset).toISOString();
          setSavedPass({ ...pass, meeting: { ...pass.meeting, arrivalTime: shift(pass.meeting.arrivalTime) },
            leaveTime: shift(pass.leaveTime), estimatedArrivalTime: shift(pass.estimatedArrivalTime), routeTargetTime: shift(pass.routeTargetTime),
            legs: pass.legs.map(leg => ({ ...leg, startTimeMs: leg.startTimeMs === null ? null : leg.startTimeMs + offset,
              endTimeMs: leg.endTimeMs === null ? null : leg.endTimeMs + offset,
              estimatedStartTime: leg.estimatedStartTime ? shift(leg.estimatedStartTime) : null,
              estimatedEndTime: leg.estimatedEndTime ? shift(leg.estimatedEndTime) : null })) });
        }}>View upcoming pass</button>
      </header>
      <div className="travel-pass-body p-5 md:p-6"><TravelPassContent pass={{ ...pass, selectedJourneyId: selected }} options={[
        { id: 'bus', leaveTime, estimatedArrivalTime: time(8), durationSeconds: 480, walkingSeconds: 360, walkingDistanceMeters: 530, transferCount: 0, status: 'Not checked', selected: selected === 'bus' },
        { id: 'walk', leaveTime: time(-10), estimatedArrivalTime: time(8), durationSeconds: 1080, walkingSeconds: 1080, walkingDistanceMeters: 1400, transferCount: 0, status: 'Not checked', selected: selected === 'walk' },
      ]} originLabel="Your starting point" onSelectJourney={id => { setSelected(id); setNotice('Fixture selection only; route geometry stays synthetic.'); }} onRecheck={() => setNotice('Fixture refresh only; no network route request.')} /></div>
      {notice && <p role="status" className="p-4">{notice}</p>}
    </div>
    {image && <div style={{ position: 'fixed', inset: 0, zIndex: 1600, overflowY: 'auto', background: '#08121d', padding: 16 }}><button className="btn-secondary mb-4" onClick={() => setImage('')}>Back to pass</button><a href={image} download="transitreach-pass-design-preview.png" className="btn-secondary ml-3">Save preview image</a><img src={image} alt="Redesigned synthetic travel pass PNG" className="mx-auto w-full max-w-2xl" /></div>}
    {savedPass && <SavedTravelPass pass={savedPass} onClose={() => setSavedPass(null)} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
