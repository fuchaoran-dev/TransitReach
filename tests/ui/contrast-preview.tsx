// Synthetic visual fixture only; does not request journeys or write room data.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { MapContainer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ServicePins } from '../../src/features/reachability/components/ServicePins';
import { VectorBaseLayer } from '../../src/features/reachability/components/VectorBaseLayer';
import { ServiceList } from '../../src/features/essential-services/components/ServiceList';
import { ServiceDetail } from '../../src/features/essential-services/components/ServiceDetail';
import { CATEGORY_ORDER, CATEGORY_META } from '../../src/shared/data';
import type { ServiceLocation } from '../../src/shared/types/service';
import { MapDaylight } from '../../src/pages/components/WeatherPlanning';

const services: ServiceLocation[] = CATEGORY_ORDER.map((category, index) => ({
  id: category, name: `Fixture ${CATEGORY_META[category].label}`, category,
  pos: { x: 0, y: 0 }, lat: 3.12 + Math.floor(index / 5) * .025,
  lon: 101.64 + (index % 5) * .025,
}));

export function Preview() {
  const [day, setDay] = useState(true);
  const [selected, setSelected] = useState(services[0]);
  const [hovered, setHovered] = useState<ServiceLocation | null>(null);
  return <div className="transit-shell p-5">
    <h1 className="text-xl font-bold">Synthetic service contrast fixture</h1>
    <button className="btn-secondary my-3" onClick={() => setDay(!day)}>{day ? 'Switch to night map' : 'Switch to day map'}</button>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3">
        <button className="w-full rounded-xl border border-teal-400 bg-teal-50/70 p-3 text-left text-slate-700">Selected journey — pale text on dark teal</button>
        <button className="w-full rounded-xl bg-white/70 hover:bg-white p-3 text-left text-slate-700">Hover this journey — background stays dark</button>
        <ServiceDetail service={selected} onClear={() => setSelected(services[0])} />
      </div>
      <div className={day ? 'map-daylight' : 'map-night'} style={{ height: 500 }}>
        <MapDaylight.Provider value={day}>
          <MapContainer center={[3.145, 101.69]} zoom={12} style={{ height: '100%' }}><VectorBaseLayer /><ServicePins services={services} selectedServiceId={selected.id} onServiceSelect={setSelected} /></MapContainer>
        </MapDaylight.Provider>
      </div>
      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        <ServiceList compact services={services} selectedService={selected} hoveredService={hovered} onHover={setHovered} onSelect={setSelected} />
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
