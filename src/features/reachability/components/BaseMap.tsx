import {
  useEffect,
  type ReactNode,
} from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import type { LatLng, Origin } from '../types';
import { NETWORK_CENTRE } from '../reachabilityService';
import type { ServiceLocation } from '@/shared/types/service';
import { CATEGORY_META } from '@/shared/data';

/**
 * OpenStreetMap raster tiles.
 *
 * The attribution below is a licence obligation under the ODbL, not a design choice
 * (AC 1.3.3). Leaflet renders its attribution control on every view and offers the user
 * no way to dismiss it; do not pass `attributionControl={false}` or override this string.
 *
 * OSM's tile usage policy governs this endpoint. Student-scale traffic sits inside it
 * only while valid attribution is displayed. A heavier deployment needs its own tiles.
 */
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DEFAULT_ZOOM = 11;
const ORIGIN_ZOOM = 15;

/**
 * The reachable area's colour.
 *
 * Graphite, not teal. Every layer on this map used to be some shade of teal — the area,
 * the origin, the walking route, the selected station, and the Banks category at
 * teal-500 — so colour told you nothing about what you were looking at, and a bank dot
 * over the area fill was effectively invisible. Colour now carries one meaning each:
 *
 *   graphite  the reachable area
 *   teal      you and your route (origin, walking line, selected station)
 *   category  essential services, each ringed in white so it reads over any fill
 *
 * The area takes the neutral because it is the largest surface and the only one that can
 * afford to recede. It cannot take a green or teal either way: Markets and Parks are
 * green, and they cannot all move.
 *
 * AC 1.3.1's checkable requirement is that "street names and base map features remain
 * readable through it". The epic proposed 40% and the team settled on 25% teal; 18%
 * graphite is lighter still, so the criterion holds with room to spare. The boundary
 * carries the weight instead — a stronger, darker stroke, which is what a reader
 * actually traces when asking how far the area extends.
 */
const FILL_OPACITY = 0.18;
const AREA_COLOR = '#475569';
const AREA_STROKE_COLOR = '#334155';

interface BaseMapProps {
  origin: Origin | null;
  /** Disjoint reachable regions, or null when there is nothing to draw. */
  regions: IsochroneRegion[] | null;
  onMapClick: (at: LatLng) => void;
  services?: ServiceLocation[];
  selectedServiceId?: string | null;
  onServiceSelect?: (service: ServiceLocation) => void;
  children?: ReactNode;
}

/** Reports map clicks. AC 1.1.2 — a click sets or moves the single starting point. */
function ClickHandler({ onMapClick }: { onMapClick: (at: LatLng) => void }) {
  useMapEvents({
    click: e => onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng }),
  });
  return null;
}

/**
 * Keeps Leaflet's idea of the container size in step with the real one.
 *
 * The map mounts inside a page transition, so on the first frame the container can be a
 * fraction of its final height. Leaflet caches that size and converts screen clicks to
 * coordinates against it, which silently shifts every clicked point — by roughly 30 km
 * north-south here — until the size is invalidated.
 */
function ResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    map.invalidateSize();

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/**
 * Follows the origin: eases to a stop chosen by name, and returns to the default view
 * when the origin is cleared (AC 1.1.5). A map click is deliberately not followed —
 * the user is already looking at the point they tapped.
 */
function ViewController({ origin }: { origin: Origin | null }) {
  const map = useMap();

  useEffect(() => {
    if (!origin) {
      map.setView([NETWORK_CENTRE.lat, NETWORK_CENTRE.lon], DEFAULT_ZOOM);
      return;
    }
    if (origin.source === 'map') return;
    map.setView([origin.at.lat, origin.at.lon], ORIGIN_ZOOM);
  }, [origin, map]);

  return null;
}

/**
 * The origin marker.
 *
 * A pin, and deliberately the loudest thing on the map. As two flat teal circles it was
 * indistinguishable from everything else drawn in teal — the reachable area, the walking
 * route, the selected station, the live-vehicle rings — and on a busy view you could not
 * find your own starting point at all. Colour and size were not enough on their own,
 * because every other layer here is also a disc; the shape is what separates it. Styling
 * lives in index.css under `.origin-marker-pin`.
 *
 * A divIcon rather than Leaflet's default marker: that icon resolves its PNGs by relative
 * URL, which Vite does not rewrite, so it renders broken without shipping the images
 * through public/. Inline HTML has no such dependency — LiveTransitMapLayer does the same.
 *
 * `iconAnchor` puts the pin's *tip* on the coordinate, not its centre: a pin that floats
 * with its middle on the point is pointing 20px north of where the user actually is. The
 * value follows from the geometry — the head is a 32px box at left 6, top 2, so its
 * centre is (22, 18), and rotating it 45° puts the tip half a diagonal below that.
 *
 * The class name `origin-marker` is load-bearing for the acceptance checks that assert
 * AC 3.1.4's "the starting point is drawn distinctly"; keep it if this is restyled.
 */
const originIcon = divIcon({
  className: 'origin-marker',
  html: '<div class="origin-marker-pin"></div><span class="origin-marker-ground"></span>',
  iconSize: [44, 46],
  iconAnchor: [22, 41],
});

function OriginPin({ at }: { at: LatLng }) {
  return (
    <Marker
      position={[at.lat, at.lon]}
      icon={originIcon}
      // Above the area fill, and above the service dots that share markerPane.
      zIndexOffset={1000}
      interactive={false}
    />
  );
}

/**
 * The reachable area.
 *
 * Each region is drawn as its own polygon. AC 1.3.1 forbids merging non-contiguous
 * areas — a pocket around a distant station stays a separate shape rather than being
 * absorbed into one enclosing hull. OTP returns them already disjoint; this just keeps
 * them that way. Holes are passed through as inner rings so enclosed unreachable ground
 * is not painted as reachable.
 */
function ReachabilityLayer({ regions }: { regions: IsochroneRegion[] }) {
  return (
    <>
      {regions.map((region, i) => (
        <Polygon
          key={i}
          // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
          positions={[region.outer, ...region.holes].map(ring =>
            ring.map(([lon, lat]) => [lat, lon] as [number, number]),
          )}
          pathOptions={{
            className: 'reach-area',
            color: AREA_STROKE_COLOR,
            weight: 2,
            opacity: 0.7,
            fillColor: AREA_COLOR,
            fillOpacity: FILL_OPACITY,
          }}
          interactive={false}
        />
      ))}
    </>
  );
}

function ServicePins({ services, selectedServiceId, onServiceSelect }: Pick<BaseMapProps, 'services' | 'selectedServiceId' | 'onServiceSelect'>) {
  return <>
    {(services ?? []).map(service => {
      if (service.lat === undefined || service.lon === undefined) return null;
      const color = CATEGORY_META[service.category].color;
      const selected = service.id === selectedServiceId;
      return (
        <CircleMarker
          key={service.id}
          center={[service.lat, service.lon]}
          radius={selected ? 9 : 6}
          pane="markerPane"
          // White ring, category fill. Ringing every dot is what lets a category hue read
          // against the area fill, against the base map, and against the dot beside it —
          // stroking each dot in its own colour left it blending into whatever was behind.
          pathOptions={{
            color: '#ffffff',
            weight: selected ? 3 : 1.5,
            fillColor: color,
            fillOpacity: selected ? 1 : 0.9,
          }}
          eventHandlers={{ click: () => onServiceSelect?.(service) }}
        />
      );
    })}
  </>;
}

export function BaseMap({ origin, regions, onMapClick, services, selectedServiceId, onServiceSelect, children, }: BaseMapProps) {
  return (
    <MapContainer
      center={[NETWORK_CENTRE.lat, NETWORK_CENTRE.lon]}
      zoom={DEFAULT_ZOOM}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
    >
      <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
      {/* Must precede ViewController so the container size is correct before the view is set. */}
      <ResizeHandler />
      <ClickHandler onMapClick={onMapClick} />
      <ViewController origin={origin} />
      {/* The area is drawn first so the origin pin sits above the fill (AC 1.3.1). */}
      {regions && <ReachabilityLayer regions={regions} />}
      <ServicePins services={services} selectedServiceId={selectedServiceId} onServiceSelect={onServiceSelect} />
      {children}
      {origin && <OriginPin at={origin.at} />}
    </MapContainer>
  );
}
