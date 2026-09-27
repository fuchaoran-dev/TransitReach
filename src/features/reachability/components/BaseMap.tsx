import {
  createElement,
  useEffect,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapContainer, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet';
import { divIcon, latLngBounds, type DivIcon, type Marker as LeafletMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import type { LatLng, Origin } from '../types';
import { NETWORK_CENTRE, STUDY_AREA } from '../reachabilityService';
import type { ServiceCategory, ServiceLocation } from '@/shared/types/service';
import { CATEGORY_META } from '@/shared/data';
import { VectorBaseLayer } from './VectorBaseLayer';

const DEFAULT_ZOOM = 11;
const ORIGIN_ZOOM = 15;

/**
 * The map stops at the Klang Valley. Nothing outside the study area can be selected or
 * computed (AC 1.1.2), so letting the user pan to Penang or zoom out to the whole world
 * only offers places the app cannot answer for, and loads tiles for them. The bounds are
 * the study area with a little margin, so its edge is not flush with the screen edge.
 */
const MIN_ZOOM = 10;
const STUDY_BOUNDS = latLngBounds(
  [STUDY_AREA.minLat, STUDY_AREA.minLon],
  [STUDY_AREA.maxLat, STUDY_AREA.maxLon],
);
const MAP_BOUNDS = STUDY_BOUNDS.pad(0.1);

/**
 * Fades everything outside the study area. At the widest zoom a screen is larger than the
 * study area, so towns beyond it (Seremban, Bentong) still show; the fade says plainly
 * that they are not covered, before a click there is rejected. Not interactive, so a
 * click on it still reaches the map and gets the usual out-of-area message.
 */
function OutsideStudyAreaMask() {
  const outer = STUDY_BOUNDS.pad(4);
  const ring = (b: typeof outer) => [
    [b.getSouth(), b.getWest()],
    [b.getNorth(), b.getWest()],
    [b.getNorth(), b.getEast()],
    [b.getSouth(), b.getEast()],
  ] as [number, number][];
  return (
    <Polygon
      positions={[ring(outer), ring(STUDY_BOUNDS)]}
      pathOptions={{ stroke: false, fillColor: '#f8fafc', fillOpacity: 0.6 }}
      interactive={false}
    />
  );
}

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
  /** Selected service to focus without leaving the Services tab. */
  selectedService?: ServiceLocation | null;
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
 * when the origin is cleared (AC 1.1.5). A map click or drag is not re-centred — the user
 * is already looking at that point — unless it has ended up at the very edge of the view,
 * where the pin would be cut off; then the map pans just enough to bring it back in.
 */
function ViewController({ origin }: { origin: Origin | null }) {
  const map = useMap();

  useEffect(() => {
    if (!origin) {
      map.setView([NETWORK_CENTRE.lat, NETWORK_CENTRE.lon], DEFAULT_ZOOM);
      return;
    }
    if (origin.source === 'map') {
      if (!map.getBounds().pad(-0.1).contains([origin.at.lat, origin.at.lon])) {
        map.panTo([origin.at.lat, origin.at.lon]);
      }
      return;
    }
    map.setView([origin.at.lat, origin.at.lon], ORIGIN_ZOOM);
  }, [origin, map]);

  return null;
}

/**
 * Focuses a service after the user explicitly selects it. Selection itself stays in the
 * Services tab; this controller only moves the camera so the service and its surrounding
 * streets are easy to inspect before the user chooses to open Journey.
 */
function ServiceViewController({
  service,
}: {
  service: ServiceLocation | null | undefined;
}) {
  const map = useMap();

  useEffect(() => {
    if (service?.lat === undefined || service.lon === undefined) return;

    map.flyTo(
      [service.lat, service.lon],
      Math.max(map.getZoom(), 16),
      { duration: 0.6 },
    );
  }, [service?.id, service?.lat, service?.lon, map]);

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
  // The "Start" tag names the pin outright: a shape alone still has to be learned, and a
  // first-time rider looking at a journey drawn from here should not have to guess which
  // end is theirs. It sits above the head so it never covers the point itself.
  html:
    '<span style="position:absolute;left:22px;top:-18px;transform:translateX(-50%);' +
    'padding:1px 7px;border-radius:9999px;background:#0f766e;color:#fff;font:700 11px/16px system-ui,sans-serif;' +
    'white-space:nowrap;border:1.5px solid #fff">Start</span>' +
    '<div class="origin-marker-pin"></div><span class="origin-marker-ground"></span>',
  iconSize: [44, 46],
  iconAnchor: [22, 41],
});

/**
 * Draggable, so a rider can nudge the start onto the right side of a road or the right
 * station entrance without hunting for the exact pixel to click. The drop goes through
 * the same handler as a map click, so it gets the same study-area check.
 */
function OriginPin({ at, onMove }: { at: LatLng; onMove: (at: LatLng) => void }) {
  return (
    <Marker
      position={[at.lat, at.lon]}
      icon={originIcon}
      // Above the area fill, and above the service pins that share markerPane.
      zIndexOffset={1000}
      draggable
      title="Starting point — drag to move"
      eventHandlers={{
        dragend: e => {
          const { lat, lng } = (e.target as LeafletMarker).getLatLng();
          onMove({ lat, lon: lng });
        },
      }}
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

/**
 * A service pin: the category's own icon on a disc of the category colour, ringed in
 * white. Colour alone could not carry thirteen categories — Schools and Food read as the
 * same orange dot — so the icon, the same one on the category's filter chip, is what
 * tells them apart. The white ring still lets the colour read over the area fill.
 *
 * One icon per category and state, built once: the pins are re-rendered on every filter
 * change and there can be hundreds of them.
 */
const serviceIconCache = new Map<string, DivIcon>();

function serviceIcon(category: ServiceCategory, selected: boolean): DivIcon {
  const key = `${category}:${selected}`;
  const cached = serviceIconCache.get(key);
  if (cached) return cached;

  const meta = CATEGORY_META[category];
  const size = selected ? 30 : 22;
  const glyph = renderToStaticMarkup(
    createElement(meta.icon, { size: selected ? 17 : 13, color: '#ffffff', strokeWidth: 2.5 }),
  );
  const icon = divIcon({
    className: 'service-pin',
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${meta.color};` +
      `border:${selected ? 3 : 2}px solid #ffffff;box-shadow:0 1px 3px rgba(15,23,42,.35);` +
      `display:flex;align-items:center;justify-content:center;box-sizing:border-box">${glyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  serviceIconCache.set(key, icon);
  return icon;
}

function ServicePins({ services, selectedServiceId, onServiceSelect }: Pick<BaseMapProps, 'services' | 'selectedServiceId' | 'onServiceSelect'>) {
  return <>
    {(services ?? []).map(service => {
      if (service.lat === undefined || service.lon === undefined) return null;
      const selected = service.id === selectedServiceId;
      return (
        <Marker
          key={service.id}
          position={[service.lat, service.lon]}
          icon={serviceIcon(service.category, selected)}
          title={service.name}
          // Selected pin above its neighbours; the origin pin (1000) stays above both.
          zIndexOffset={selected ? 500 : 0}
          // A service click is an inspection action, not a new-origin map click. Marker
          // clicks do not bubble to the map, so ClickHandler never sees it.
          eventHandlers={{ click: () => onServiceSelect?.(service) }}
        />
      );
    })}
  </>;
}

export function BaseMap({ origin, regions, onMapClick, services, selectedServiceId, selectedService, onServiceSelect, children, }: BaseMapProps) {
  return (
    <MapContainer
      center={[NETWORK_CENTRE.lat, NETWORK_CENTRE.lon]}
      zoom={DEFAULT_ZOOM}
      minZoom={MIN_ZOOM}
      maxBounds={MAP_BOUNDS}
      maxBoundsViscosity={1}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
    >
      {/*
        Base map and its licence attribution (AC 1.3.3). Leaflet renders the attribution
        control on every view; do not pass `attributionControl={false}`.
      */}
      <VectorBaseLayer />
      <OutsideStudyAreaMask />
      {/* Must precede ViewController so the container size is correct before the view is set. */}
      <ResizeHandler />
      <ClickHandler onMapClick={onMapClick} />
      <ViewController origin={origin} />
      <ServiceViewController service={selectedService} />
      {/* The area is drawn first so the origin pin sits above the fill (AC 1.3.1). */}
      {regions && <ReachabilityLayer regions={regions} />}
      <ServicePins services={services} selectedServiceId={selectedServiceId} onServiceSelect={onServiceSelect} />
      {children}
      {origin && <OriginPin at={origin.at} onMove={onMapClick} />}
    </MapContainer>
  );
}
