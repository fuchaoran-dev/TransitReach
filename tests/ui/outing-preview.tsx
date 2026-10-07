// Development-only fixtures: no accounts, database writes, actual journeys or forecasts.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { InvitationCard } from '../../src/features/outing-pass/components/InvitationCard';
import { PersonalPassView } from '../../src/features/outing-pass/components/PersonalPassView';
import { GroupStatus } from '../../src/features/outing-pass/components/GroupStatus';
import { PrivateJourneyMap } from '../../src/features/outing-pass/components/PrivateJourneyMap';
import { generateRoomQrDataUrl, downloadPassImage, renderPassImage } from '../../src/features/outing-pass/passExport';
import type { PersonalPass } from '../../src/features/outing-pass/types';
import type { MeetingRoom, SharedMemberStatus } from '../../src/features/meeting-point/types';

const room: MeetingRoom = {
  code: 'ABCDEFGH', timeBudget: 45, expiresAt: '2026-10-12T12:00:00Z', proposedArrivalTime: null,
  confirmedPlan: { version: 3, arrivalTime: '2026-10-10T18:30:00+08:00', venue: { id: 'fixture-venue', type: 'mall', name: 'Fixture Sunway meeting', kindLabel: 'Test destination', lat: 3.0733, lon: 101.6067 } },
};
const members: SharedMemberStatus[] = [
  { id: 'a', displayName: 'Fixture Aina', arrivalStatus: 'Ready', isSelf: false },
  { id: 'b', displayName: 'Fixture Jia Wei', arrivalStatus: 'Check needed', isSelf: true },
  { id: 'c', displayName: 'Fixture Kumar', arrivalStatus: 'Not checked', isSelf: false },
];
const pass: PersonalPass = {
  schemaVersion: 1, kind: 'group-outing', id: 'fixture', roomCode: room.code, memberId: 'fixture-self', planVersion: 3,
  checkedAt: '2026-10-07T16:00:00+08:00', routeTargetTime: room.confirmedPlan!.arrivalTime, meeting: room.confirmedPlan!,
  selectedJourneyId: 'journey-0', leaveTime: '2026-10-10T17:40:00+08:00', estimatedArrivalTime: '2026-10-10T18:22:00+08:00', arrivalMarginSeconds: 480, status: 'Not checked',
  legs: [{ id: 'leg-0', mode: 'WALK', routeId: null, routeShortName: null, routeLongName: null, routeColor: null, durationSeconds: 720, distanceMeters: 800, startTimeMs: Date.parse('2026-10-10T17:40:00+08:00'), endTimeMs: Date.parse('2026-10-10T17:52:00+08:00'), from: { name: 'Fixture private start', stopId: null, lat: 3.1, lon: 101.6 }, to: { name: 'Fixture station', stopId: 'fixture-stop', lat: 3.11, lon: 101.61 }, geometry: [{ lat: 3.1, lon: 101.6 }, { lat: 3.105, lon: 101.608 }, { lat: 3.11, lon: 101.61 }], transitLeg: false, steps: [{ relativeDirection: 'CONTINUE', streetName: 'Fixture walkway', bogusName: false, distanceMeters: 800, lat: 3.1, lon: 101.6 }], estimatedStartTime: '2026-10-10T17:40:00+08:00', estimatedEndTime: '2026-10-10T17:52:00+08:00', cumulativeDelaySeconds: 0, delay: null }],
  connections: [{ id: 'connection-0', atName: 'Fixture interchange', fromLegIndex: 0, toLegIndex: 1, estimatedArrivalTime: '2026-10-10T18:00:00+08:00', estimatedDepartureTime: '2026-10-10T18:06:00+08:00', spareSeconds: 360, status: 'checked' }],
  walking: { totalSeconds: 720, totalDistanceMeters: 800, directions: [] },
  weather: [{ status: 'checked', period: 'Afternoon', summary: 'Fixture light rain', source: 'MET Malaysia via data.gov.my', sourceUrl: 'https://data.gov.my', location: 'Fixture Kuala Lumpur', retrievedAt: '2026-10-07T15:55:00+08:00', walkingSecondsInPeriod: 720 }],
  closingMargin: { status: 'not-checked', label: 'Hours unknown', reason: 'hours-missing' },
  weakPoint: { kind: 'connection', marginSeconds: 360, label: 'TEST FIXTURE: the interchange leaves 6 min spare after a typical delay.' },
};

function Preview() {
  const [view, setView] = useState('invitation');
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  return <div className="transit-shell min-h-screen">
    <header className="p-4 border-b border-slate-700"><strong>TEST FIXTURE — synthetic data, no live room</strong><div className="flex flex-wrap gap-3 mt-3">{['invitation', 'pass', 'status'].map(value => <button key={value} className="btn-secondary" aria-pressed={view === value} onClick={() => setView(value)}>{value}</button>)}<button className="btn-secondary" onClick={() => void generateRoomQrDataUrl(room.code).then(setQr)}>Generate room QR</button></div></header>
    <main className="max-w-5xl mx-auto p-4 md:p-8"><p role="status" className="mb-4">{notice}</p><div className="grid lg:grid-cols-2 gap-6">
      <div>{view === 'invitation' ? <InvitationCard room={room} memberCount={3} hasOrigin onOpen={() => setView('pass')} onEditOrigin={() => setNotice('Fixture: edit own origin')} onSuggestTime={() => setNotice('Fixture: proposal requires explicit confirmation')} /> : view === 'status' ? <GroupStatus members={members} /> : <PersonalPassView pass={pass} options={[]} busy={false} onBack={() => setView('invitation')} onRecheck={() => setNotice('Fixture: re-check requested')} onSelectJourney={() => setNotice('Fixture: replacement check requested')} onLeaveEarlier={() => setNotice('Fixture: arrive-by target moved earlier')} onSuggestTime={() => setNotice('Fixture: proposal requested')} onDownload={() => void downloadPassImage(pass).then(() => setNotice('Fixture image downloaded'))} />}</div>
      <div className="space-y-4">{view === 'pass' && <PrivateJourneyMap pass={pass} />}{view !== 'status' && <GroupStatus members={members} />}{qr && <section className="outing-card"><img className="outing-qr" src={qr} alt="Fixture room invitation QR" /><p className="mt-3">Room reference only · ABCDEFGH</p></section>}<button className="btn-secondary" onClick={() => void renderPassImage(pass).then(blob => setImagePreview(URL.createObjectURL(blob)))}>Preview offline image</button>{imagePreview && <img src={imagePreview} alt="Synthetic offline pass PNG preview" className="w-full" />}</div>
    </div></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
