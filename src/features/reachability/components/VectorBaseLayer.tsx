import { useEffect, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import type { Layer } from 'leaflet';
import type { StyleSpecification } from 'maplibre-gl';
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
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** How long the vector map gets to finish its first draw before raster tiles take over. */
const LOAD_DEADLINE_MS = 10_000;

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

function trimStyle(style: StyleSpecification): StyleSpecification {
  const layers = style.layers
    .filter(layer => !DROPPED_LAYERS.has(layer.id))
    .map(layer => {
      const paint = PAINT_OVERRIDES[layer.id];
      const recoloured = paint ? { ...layer, paint: { ...layer.paint, ...paint } } : layer;
      return layer.id === 'highway-name-major'
        ? { ...recoloured, filter: ['match', ['get', 'class'], NAMED_ROAD_CLASSES, true, false] }
        : recoloured;
    }) as StyleSpecification['layers'];
  return { ...style, layers };
}

export function VectorBaseLayer() {
  const map = useMap();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let layer: Layer | null = null;

    let loadTimer: ReturnType<typeof setTimeout> | undefined;

    const removeLayer = () => {
      if (!layer) return;
      map.removeLayer(layer);
      map.attributionControl?.removeAttribution(VECTOR_ATTRIBUTION);
      layer = null;
    };

    Promise.all([
      import('maplibre-gl'),
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      fetch(STYLE_URL).then(response => {
        if (!response.ok) throw new Error(`Style request failed: ${response.status}`);
        return response.json() as Promise<StyleSpecification>;
      }),
    ])
      .then(([maplibre, { maplibreGL }, , style]) => {
        if (cancelled) return;
        // MapLibre derives its worker's URL at runtime, which Vite cannot see, so the
        // worker is never bundled and the map silently draws nothing. Hand it the URL of
        // a worker Vite has built.
        maplibre.setWorkerUrl(maplibreWorkerUrl);
        // Throws when WebGL is unavailable; caught below and answered with raster tiles.
        const gl = maplibreGL({ style: trimStyle(style), attributionControl: false });
        layer = gl.addTo(map);
        map.attributionControl?.addAttribution(VECTOR_ATTRIBUTION);

        // A failure after this point (worker, tiles) is asynchronous and throws nothing,
        // so give the map a deadline to draw and fall back if it misses it.
        loadTimer = setTimeout(() => {
          if (cancelled) return;
          removeLayer();
          setFailed(true);
        }, LOAD_DEADLINE_MS);
        gl.getMaplibreMap().once('load', () => clearTimeout(loadTimer));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(loadTimer);
      removeLayer();
    };
  }, [map]);

  return failed ? <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} /> : null;
}
