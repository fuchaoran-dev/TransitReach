import { useContext, useEffect, useRef, useState } from 'react';
import { MapDaylight } from '@/pages/components/WeatherPlanning';
import { Box, MapPin, X } from 'lucide-react';
import type { Map as GLMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Origin } from '../types';
import type { ServiceLocation } from '@/shared/types/service';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import { STYLE_URL, trimStyle, applyMapDaylight } from './VectorBaseLayer';
import type { ModelledJourney } from '@/features/interchange/types';
import type { WalkStep } from '@/shared/services/transitRoutingClient';
import { updateCoverageScene, updateJourneyScene, type DepartureCoverage } from './journeyScene';

interface Props {
  journey?: ModelledJourney | null;
  highlightedLegId?: string | null;
  focusedStep?: WalkStep | null;
  service?: ServiceLocation | null;
  origin: Origin | null;
  regions: IsochroneRegion[] | null;
  coverage?: DepartureCoverage | null;
}

/** Native MapLibre scene: the camera and its overlays use the same projection. */
export function CityFocusView({ service, origin, regions, coverage, journey, highlightedLegId, focusedStep }: Props) {
  const daylight = useContext(MapDaylight);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const styleRef = useRef<StyleSpecification | null>(null);
  const daylightRef = useRef(daylight);
  daylightRef.current = daylight;
  const lat = service?.lat ?? origin?.at.lat;
  const lon = service?.lon ?? origin?.at.lon;
  const hasCoordinates = lat !== undefined && lon !== undefined;
  const focusRef = useRef({ lat, lon });
  focusRef.current = { lat, lon };

  useEffect(() => {
    if (service?.id && service.lat !== undefined && service.lon !== undefined) setOpen(true);
  }, [service?.id, service?.lat, service?.lon]);

  useEffect(() => {
    // Clearing the last location must not leave an empty 3D surface over Leaflet.
    if (!hasCoordinates) setOpen(false);
  }, [hasCoordinates]);

  useEffect(() => {
    if (!open || !host.current || !hasCoordinates) return;
    let disposed = false;
    const controller = new AbortController();
    let observer: ResizeObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('loading');
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    Promise.all([
      import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css'),
      fetch(STYLE_URL, { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error('Map style unavailable');
        return response.json() as Promise<StyleSpecification>;
      }),
    ]).then(([gl, , rawStyle]) => {
      if (disposed || !host.current) return;
      gl.setWorkerUrl(workerUrl);
      styleRef.current = rawStyle;
      const style = trimStyle(rawStyle, daylightRef.current);
      const building = style.layers.find(layer => layer.type === 'fill' && layer.id === 'building');
      if (building && 'source' in building) {
        const labelIndex = style.layers.findIndex(layer => layer.type === 'symbol');
        style.layers.splice(labelIndex < 0 ? style.layers.length : labelIndex, 0, {
          id: 'city-buildings', type: 'fill-extrusion', source: building.source,
          'source-layer': 'building', minzoom: 14,
          paint: {
            'fill-extrusion-color': daylightRef.current ? '#c6c2b6' : '#376079', 'fill-extrusion-opacity': 0.88,
            'fill-extrusion-height': ['max', 0, ['to-number', ['get', 'render_height'], 0]],
            'fill-extrusion-base': ['max', 0, ['to-number', ['get', 'render_min_height'], 0]],
          },
        });
      }
      const focus = focusRef.current;
      if (focus.lat === undefined || focus.lon === undefined) return;
      const map = new gl.Map({ container: host.current, style, center: [focus.lon, focus.lat], zoom: 14, pitch: 0, attributionControl: { compact: true } });
      mapRef.current = map;
      map.addControl(new gl.NavigationControl({ visualizePitch: true }), 'bottom-left');
      observer = new ResizeObserver(() => map.resize());
      observer.observe(host.current);
      timer = setTimeout(() => { if (!disposed) setStatus('error'); }, 15000);
      map.once('load', () => {
        if (disposed) return;
        clearTimeout(timer);
        map.addSource('location-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'location-pins', type: 'circle', source: 'location-pins', paint: {
          'circle-radius': 9, 'circle-color': ['match', ['get', 'kind'], 'origin', '#53e5d5', '#ff8198'],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
        } });
        map.addLayer({ id: 'location-pin-labels', type: 'symbol', source: 'location-pins', layout: {
          'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.8], 'text-allow-overlap': true,
        }, paint: { 'text-color': '#14333e', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
          map.addSource('reach', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'reach-fill', type: 'fill', source: 'reach', paint: { 'fill-color': '#34d9cb', 'fill-opacity': 0.12 } });
          map.addLayer({ id: 'reach-edge', type: 'line', source: 'reach', paint: { 'line-color': '#70eee4', 'line-width': 2 } });
        applyMapDaylight(map, rawStyle, daylightRef.current);
        setStatus('ready');
      });
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, hasCoordinates]);

  useEffect(() => {
    if (!mapRef.current || status !== 'ready' || !open || lat === undefined || lon === undefined) return;
    mapRef.current.flyTo({ center: [lon, lat], zoom: 16.6, pitch: 55, bearing: -18, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700 });
  }, [service?.id, lat, lon, status, open]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !open) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    if (origin) features.push({ type: 'Feature', properties: { kind: 'origin', label: 'Starting point' }, geometry: { type: 'Point', coordinates: [origin.at.lon, origin.at.lat] } });
    if (service?.lat !== undefined && service.lon !== undefined) features.push({ type: 'Feature', properties: { kind: 'destination', label: service.name }, geometry: { type: 'Point', coordinates: [service.lon, service.lat] } });
    (map.getSource('location-pins') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }, [origin, service, status, open, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !open) return;
    (map.getSource('reach') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection', features: (regions ?? []).map(region => ({
        type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [region.outer, ...region.holes] },
      })),
    });
  }, [regions, status, open, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && status === 'ready' && open) updateCoverageScene(map, coverage ?? null);
  }, [coverage, status, open]);

  useEffect(() => {
    if (mapRef.current && styleRef.current && status === 'ready' && open) applyMapDaylight(mapRef.current, styleRef.current, daylight);
  }, [daylight, status, open, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    // Once the scene has loaded, GeoJSON updates may temporarily make
    // isStyleLoaded() false. Do not lose route updates during that interval.
    if (map && status === 'ready' && open) updateJourneyScene(map, journey ?? null, highlightedLegId ?? null);
  }, [journey, highlightedLegId, status, open, daylight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !journey || status !== 'ready' || !open) return;
    const points = journey.legs.flatMap(leg => leg.geometry);
    if (points.length > 1) map.fitBounds([[Math.min(...points.map(p => p.lon)), Math.min(...points.map(p => p.lat))], [Math.max(...points.map(p => p.lon)), Math.max(...points.map(p => p.lat))]], { padding: { top: 220, bottom: 90, left: Math.min(380, map.getContainer().clientWidth / 4), right: Math.min(400, map.getContainer().clientWidth / 4) }, pitch: 50, maxZoom: 17, duration: 700 });
  }, [journey, status, open]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && focusedStep && status === 'ready' && open) map.flyTo({ center: [focusedStep.lon, focusedStep.lat], zoom: 18, pitch: 55, duration: 600 });
  }, [focusedStep, status, open]);

  return <>
    {!open && lat !== undefined && lon !== undefined && <button className="city-view-toggle" onClick={() => setOpen(true)}><Box size={16} /> Explore in 3D</button>}
    {open && <section className="city-focus" aria-label="3D location view">
      <div ref={host} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div className="city-focus-toolbar">
      <button className="city-focus-close" onClick={() => setOpen(false)}><X size={16} /> Back to map</button>
      {origin && status === 'ready' && <button className="city-origin-return" onClick={() => mapRef.current?.flyTo({ center: [origin.at.lon, origin.at.lat], zoom: 16.6, pitch: 55, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700 })}><MapPin size={15} /> Return to starting point</button>}
      </div>
      {status === 'loading' && <div className="city-focus-message" role="status">Opening your city view…</div>}
      {status === 'error' && <div className="city-focus-message" role="alert">3D view is unavailable on this device or connection.<button className="btn-primary mt-3" onClick={() => setOpen(false)}>Return to map</button></div>}
    </section>}
  </>;
}
