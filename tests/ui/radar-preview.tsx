/* eslint-disable react-refresh/only-export-components -- Standalone synthetic animation QA entry. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, CircleMarker } from 'react-leaflet';
import { VectorBaseLayer } from '@/features/reachability/components/VectorBaseLayer';
import { MeetingRadarLayer } from '@/features/meeting-point/components/MeetingRadarLayer';
import { RADAR_DEMO_PLACES } from './radarDemoData';
import '@/index.css';
import 'leaflet/dist/leaflet.css';

function Preview() {
  const [scanning, setScanning] = useState(true);
  return <div className="transit-shell bg-[#071520] text-slate-100" style={{ height: '100dvh', position: 'relative' }}>
    <header className="absolute inset-x-0 top-0 z-[1000] flex min-h-16 items-center justify-between gap-3 bg-[#081622]/95 px-4 py-3">
      <div><h1 className="font-bold text-teal-200">TRANSITREACH · Radar preview</h1><p className="mt-1 text-[11px] text-amber-200">Demo POIs only · Real basemap · No room, route or database writes</p></div>
      <button className="btn-secondary shrink-0 text-xs" aria-pressed={scanning} onClick={() => setScanning(value => !value)}>{scanning ? 'Stop scanner' : 'Start scanner'}</button>
    </header>
    <MapContainer center={[3.0682, 101.5937]} zoom={16} zoomControl={false} style={{ height: '100%', width: '100%' }} attributionControl>
      <VectorBaseLayer />
      <CircleMarker center={[3.0682, 101.5937]} radius={9} pathOptions={{ color: '#abf4f5', fillColor: '#3599e5', fillOpacity: 1 }} />
      {scanning && <MeetingRadarLayer places={RADAR_DEMO_PLACES} />}
    </MapContainer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
