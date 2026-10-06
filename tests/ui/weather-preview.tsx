// Development-only visual fixtures. Not included in the production entry point.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../../src/index.css';
import { VectorBaseLayer } from '../../src/features/reachability/components/VectorBaseLayer';
import { MapDaylight } from '../../src/pages/components/WeatherPlanning';
import { WeatherAtmosphere } from '../../src/pages/components/WeatherAtmosphere';

function Preview() {
  const [scenario, setScenario] = useState('sunny');
  const night = scenario === 'night';
  return <div className="transit-shell" style={{ height: '100vh' }}>
    <header style={{ padding: 16, position: 'relative', zIndex: 600 }}>
      <strong>TEST FIXTURE — not a real forecast</strong>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>{['sunny', 'cloudy', 'rainy', 'storm', 'night'].map(value => <button className="btn-secondary" key={value} onClick={() => setScenario(value)}>{value}</button>)}</div>
    </header>
    {
      <MapDaylight.Provider value={!night}><div className={`epic7-map weather-${night ? 'sunny' : scenario} ${night ? 'map-night' : 'map-daylight'}`} style={{ position: 'absolute', top: 100, bottom: 0, width: '100%' }}>
        <MapContainer center={[3.139, 101.6869]} zoom={13} style={{ height: '100%', width: '100%' }}><VectorBaseLayer /></MapContainer>
        <WeatherAtmosphere />
      </div></MapDaylight.Provider>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
