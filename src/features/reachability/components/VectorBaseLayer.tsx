import { useContext, useEffect, useRef, useState } from 'react';
import { MapDaylight } from '@/pages/components/WeatherPlanning';
import { TileLayer, useMap } from 'react-leaflet';
import type { Map as GLMap, StyleSpecification } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/**
 * The base map: OpenFreeMap vector tiles drawn by MapLibre inside Leaflet.
 *
 * Raster OSM tiles bake every label into the image — shop names, house numbers, every
 * lane — and a public-transport rider reading this map needs none of it. Vector tiles let
 * the style decide per layer, so the base keeps what orients someone (neighbourhoods,
 * towns, major roads, water, parks) and drops what competes with our own layers.
 *
 * Attribution is a licence obligation (ODbL, AC 1.3.3), added here explicitly rather than
 * trusted to the style's sources, so it can never silently disappear with a style change.
 *
 * If MapLibre cannot load — the style fetch fails, or the device has no WebGL — this falls
 * back to the OSM raster tiles the map used before, so the map is never blank.
 */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** How long the vector map gets to finish its first draw before raster tiles take over. */
const LOAD_DEADLINE_MS = 25_000;

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Layers removed from the positron style. Minor-street, footpath and water-body names
 * crowd the view at the zooms people inspect a walk at, and road shields and airport
 * icons mean nothing to a bus or train rider. Neighbourhood and town names stay: they are
 * how a rider recognises where they are.
 */
const DROPPED_LAYERS = new Set([
  'highway-name-path',
  'highway-name-minor',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
  'airport',
  'water_name_point_label',
  'water_name_line_label',
  'waterway_line_label',
]);

/**
 * Road names are kept only for trunk and primary roads — the handful a rider uses as
 * landmarks ("across Jalan Bangsar"). Positron also names every secondary and tertiary
 * road, which at street zoom turns the map into a wall of "Jalan …".
 */
const NAMED_ROAD_CLASSES = ['trunk', 'primary'];

/**
 * A warm, light palette over positron's greys. Positron is all grey, so parks, water and
 * built-up land looked alike and the map read as flat and cold. These colours are soft
 * enough for our own layers to stay the loudest things on screen: the graphite reachable
 * area, the teal route and origin, and the coloured service pins. Highways get a pale
 * amber so the big roads a rider steers by stand out without shouting.
 */
const LAND = '#f5f1e8';
const PAINT_OVERRIDES: Record<string, Record<string, unknown>> = {
  background: { 'background-color': LAND },
  landuse_residential: { 'fill-color': '#efe9dc' },
  park: { 'fill-color': '#d5ebcb' },
  landcover_wood: { 'fill-color': '#cce4c0' },
  water: { 'fill-color': '#b3d8ee' },
  waterway: { 'line-color': '#a3cfe8' },
  building: { 'fill-color': '#e6dfd1', 'fill-outline-color': '#dad1c0' },
  road_area_pier: { 'fill-color': LAND },
  road_pier: { 'line-color': LAND },
  highway_path: { 'line-color': '#ebe4d6' },
  highway_minor: { 'line-color': '#ffffff' },
  highway_major_casing: { 'line-color': '#e2d8c4' },
  highway_major_inner: { 'line-color': '#ffffff' },
  highway_motorway_casing: { 'line-color': '#eccb85' },
  highway_motorway_inner: { 'line-color': '#fbe6b5' },
  highway_motorway_bridge_casing: { 'line-color': '#eccb85' },
  highway_motorway_bridge_inner: { 'line-color': '#fbe6b5' },
  tunnel_motorway_casing: { 'line-color': '#eedcb6' },
  tunnel_motorway_inner: { 'line-color': '#fbf1dc' },
  railway_transit: { 'line-color': '#cdc5b6' },
  railway_service: { 'line-color': '#cdc5b6' },
  railway: { 'line-color': '#cdc5b6' },
};

export function trimStyle(style: StyleSpecification, daylight = false): StyleSpecification {
  const layers = style.layers
    .filter(layer => !DROPPED_LAYERS.has(layer.id))
    .map(layer => {
      const paint = daylight ? PAINT_OVERRIDES[layer.id] : NIGHT_PAINT[layer.id] ?? PAINT_OVERRIDES[layer.id];
      const recoloured = paint ? { ...layer, paint: { ...layer.paint, ...paint } } : layer;
      if (layer.type === 'symbol') {
        return { ...recoloured, ...(layer.id === 'highway-name-major' ? { filter: ['match', ['get', 'class'], NAMED_ROAD_CLASSES, true, false] } : {}), paint: { ...recoloured.paint, 'text-color': daylight ? '#40576a' : '#a7bfd0', 'text-halo-color': daylight ? '#f5f1e8' : '#0b1724', 'text-halo-width': 1.4 } };
      }
      return layer.id === 'highway-name-major'
        ? { ...recoloured, filter: ['match', ['get', 'class'], NAMED_ROAD_CLASSES, true, false] }
        : recoloured;
    }) as StyleSpecification['layers'];
  return { ...style, layers };
}

const NIGHT_PAINT: Record<string, Record<string, unknown>> = {
  background: { 'background-color': '#0b1521' },
  landuse_residential: { 'fill-color': '#101e2c' },
  park: { 'fill-color': '#12312e' },
  landcover_wood: { 'fill-color': '#102a27' },
  water: { 'fill-color': '#07101c' },
  waterway: { 'line-color': '#163348' },
  building: { 'fill-color': '#21374b', 'fill-outline-color': '#36556b' },
  highway_path: { 'line-color': '#294356' },
  highway_minor: { 'line-color': '#273b4c' },
  highway_major_casing: { 'line-color': '#142536' },
  highway_major_inner: { 'line-color': '#3b566a' },
  highway_motorway_casing: { 'line-color': '#172b3c' },
  highway_motorway_inner: { 'line-color': '#4b697c' },
  railway_transit: { 'line-color': '#4c8092' },
  railway: { 'line-color': '#3b6476' },
};

/** Recolour existing layers without replacing sources, tiles or camera state. */
export function applyMapDaylight(map: GLMap, style: StyleSpecification, daylight: boolean) {
  for (const layer of trimStyle(style, daylight).layers) {
    if (!map.getLayer(layer.id) || !layer.paint) continue;
    for (const [property, value] of Object.entries(layer.paint)) map.setPaintProperty(layer.id, property as Parameters<GLMap['setPaintProperty']>[1], value);
  }
  if (map.getLayer('city-buildings')) map.setPaintProperty('city-buildings', 'fill-extrusion-color', daylight ? '#c6c2b6' : '#376079');
}

export function VectorBaseLayer() {
  const daylight = useContext(MapDaylight);
  const map = useMap();
  const [failed, setFailed] = useState(false);
  const scene = useRef<{ map: GLMap; style: StyleSpecification } | null>(null);
  const daylightRef = useRef(daylight);
  daylightRef.current = daylight;
  useEffect(() => {
    if (scene.current?.map.getLayer('background')) applyMapDaylight(scene.current.map, scene.current.style, daylight);
  }, [daylight]);

  useEffect(() => {
    setFailed(false);
    let cancelled = false;
    const controller = new AbortController();
    let nativeMap: GLMap | null = null;
    let container: HTMLDivElement | null = null;
    let detach: (() => void) | undefined;

    const removeLayer = () => {
      detach?.();
      detach = undefined;
      nativeMap?.remove();
      nativeMap = null;
      container?.remove();
      container = null;
      scene.current = null;
      map.attributionControl?.removeAttribution(VECTOR_ATTRIBUTION);
    };

    // Include the style download in the deadline; an indefinitely pending fetch
    // must fall back to raster too, not leave a blank map before GL is created.
    const loadTimer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      removeLayer();
      setFailed(true);
    }, LOAD_DEADLINE_MS);

    Promise.all([
      import('maplibre-gl'),
      import('leaflet'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      fetch(STYLE_URL, { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error(`Style request failed: ${response.status}`);
        return response.json() as Promise<StyleSpecification>;
      }),
    ])
      .then(([maplibre, leaflet, , style]) => {
        if (cancelled) return;
        // MapLibre derives its worker's URL at runtime, which Vite cannot see, so the
        // worker is never bundled and the map silently draws nothing. Hand it the URL of
        // a worker Vite has built.
        maplibre.setWorkerUrl(maplibreWorkerUrl);
        // Throws when WebGL is unavailable; caught below and answered with raster tiles.
        // Use public APIs: the older bridge relies on private renderer internals.
        container = document.createElement('div');
        container.className = 'city-vector-surface';
        container.style.pointerEvents = 'none';
        map.getPane('tilePane')!.appendChild(container);
        const centre = map.getCenter();
        const gl = new maplibre.Map({ container, style: trimStyle(style, daylightRef.current), center: [centre.lng, centre.lat], zoom: map.getZoom() - 1, interactive: false, attributionControl: false, trackResize: false });
        nativeMap = gl;
        const syncView = () => {
          if (!container || cancelled) return;
          const size = map.getSize();
          const width = `${size.x}px`; const height = `${size.y}px`;
          if (container.style.width !== width || container.style.height !== height) {
            container.style.width = width; container.style.height = height; gl.resize();
          }
          leaflet.DomUtil.setPosition(container, map.containerPointToLayerPoint([0, 0]));
          const center = map.getCenter();
          gl.jumpTo({ center: [center.lng, center.lat], zoom: map.getZoom() - 1 });
        };
        map.on('move zoom resize', syncView);
        detach = () => map.off('move zoom resize', syncView);
        syncView();
        map.attributionControl?.addAttribution(VECTOR_ATTRIBUTION);

        // A failure after this point (worker, tiles) is asynchronous and throws nothing,
        // so give the map a deadline to draw and fall back if it misses it.
        scene.current = { map: gl, style };
        gl.once('load', () => {
          clearTimeout(loadTimer);
          if (!cancelled) applyMapDaylight(gl, style, daylightRef.current);
        });
      })
      .catch(() => {
        if (!cancelled) { clearTimeout(loadTimer); removeLayer(); setFailed(true); }
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(loadTimer);
      removeLayer();
    };
  }, [map]);

  return failed ? <TileLayer className="city-raster-fallback" url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} /> : null;
}
