import { useEffect, useState } from 'react';


import {
  Polyline,
  useMap,
  Marker,
  Popup,
} from 'react-leaflet';

import L, {
  latLngBounds,
} from 'leaflet';

import type {
  FirstMileBusStopResult,
  FirstMileStopResult,
} from '../types';
import { mapBusStopById } from '../busStopService';
import { MIN_BUS_STOP_ZOOM } from './BusStopMapLayer';

/** Keeps the route clear of the panels overlaying the map's left and right edges. */
const ROUTE_PADDING: [number, number] = [80, 80];

/**
 * Close enough to read the streets, far enough not to lose the surroundings.
 * Without a cap, a 200 m walk fills the screen at building level.
 */
const ROUTE_MAX_ZOOM = 16;

interface FirstMileMapLayerProps {
  stops: FirstMileStopResult[];
  /** Bus stops in the walking window; drawn smaller than stations, and selectable the same way. */
  busStops?: FirstMileBusStopResult[];
  selectedStopId: string | null;
  onSelect: (stopId: string) => void;
}

function stationIcon(
  selected: boolean,
) {
  return L.divIcon({
    className:
      'first-mile-station-marker',

    html: `
      <div
        style="
          width: ${selected ? 34 : 28}px;
          height: ${selected ? 34 : 28}px;
          border-radius: 8px;
          background: ${
            selected
              ? '#0f766e'
              : '#ffffff'
          };
          border: 3px solid #0f766e;
          box-shadow:
            0 2px 8px rgba(0,0,0,0.28);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${
            selected ? 18 : 15
          }px;
        "
      >
        <span
          style="
            filter: ${
              selected
                ? 'brightness(0) invert(1)'
                : 'none'
            };
          "
        >
          🚉
        </span>
      </div>
    `,

    iconSize: [
      selected ? 34 : 28,
      selected ? 34 : 28,
    ],

    iconAnchor: [
      selected ? 17 : 14,
      selected ? 17 : 14,
    ],

    popupAnchor: [
      0,
      selected ? -18 : -15,
    ],
  });
}


/**
 * A first-mile bus stop, drawn exactly like the map's own bus stops (BusStopMapLayer) so it
 * reads as the same stop: white disc, blue ring, 🚏. Filled blue when selected.
 */
function busStopIcon(selected: boolean) {
  const size = selected ? 28 : 22;
  return L.divIcon({
    className: 'first-mile-bus-stop-marker',
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
      `background:${selected ? '#2563eb' : '#ffffff'};border:2px solid #2563eb;` +
      `box-shadow:0 1px 5px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;` +
      `font-size:${selected ? 15 : 13}px">🚏</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/** The map's zoom, kept current. */
function useZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const update = () => setZoom(map.getZoom());
    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
    };
  }, [map]);
  return zoom;
}

export function FirstMileMapLayer({
  stops,
  busStops = [],
  selectedStopId,
  onSelect,
}: FirstMileMapLayerProps) {
  const map = useMap();
  const zoom = useZoom();
  const selected =
    stops.find(
      item =>
        item.stop.stopId === selectedStopId,
    ) ??
    busStops.find(item => item.stop.stopId === selectedStopId) ??
    null;

  /*
   * AC 3.1.4 — bring the chosen walking connection into view.
   *
   * Selecting a station drew its route wherever it happened to be, which at the default
   * origin zoom often meant partly or wholly off-screen, and left the user to find it by
   * hand.
   *
   * `route` is a safe dependency rather than a churning one: `stops` is React state held
   * by useFirstMile, so it keeps its identity between renders and this looks up the same
   * object each time. The view therefore moves when the selection changes and at no other
   * time, which is what keeps it from fighting the user's own panning or BaseMap's
   * ViewController.
   */
  const route = selected?.route ?? null;
  useEffect(() => {
    if (!route || route.geometry.length < 2) return;

    // The geometry already runs origin → station, so its extent is the whole walk.
    map.flyToBounds(
      latLngBounds(route.geometry.map(point => [point.lat, point.lon])),
      { padding: ROUTE_PADDING, maxZoom: ROUTE_MAX_ZOOM },
    );
  }, [route, map]);

  return (
    <>
      {/* AC 3.1.4 — all candidate stations */}
      {stops.map(result => {
        return (
          <Marker
            key={result.stop.stopId}
            position={[
              result.stop.lat,
              result.stop.lon,
            ]}
            icon={stationIcon(
              result.stop.stopId ===
                selectedStopId,
            )}
            eventHandlers={{
              click: () =>
                onSelect(
                  result.stop.stopId,
                ),
            }}
          >
            <Popup>
              <div>
                <strong>
                  {result.stop.name}
                </strong>

                <div>
                  Accessible station
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {busStops.map(result =>
        // From MIN_BUS_STOP_ZOOM in, the map's bus-stop layer draws its own stops, first-
        // mile's among them (MapPage adds them), with Epic 4's delay popup. Only stops that
        // layer does not know, MRT feeder-only poles, are still drawn here.
        zoom >= MIN_BUS_STOP_ZOOM && mapBusStopById(result.stop.stopId) ? null : (
        <Marker
          key={result.stop.stopId}
          position={[result.stop.lat, result.stop.lon]}
          icon={busStopIcon(result.stop.stopId === selectedStopId)}
          eventHandlers={{ click: () => onSelect(result.stop.stopId) }}
        >
          <Popup>
            <div>
              <strong>{result.stop.name}</strong>
              <div>Bus stop · {result.routes.map(route => route.name).join(', ')}</div>
            </div>
          </Popup>
        </Marker>
        ),
      )}

      {/* AC 3.1.2 + 3.1.4 — actual OSM walking geometry */}
      {selected &&
        selected.route.geometry.length >
          1 && (
          <Polyline
            positions={selected.route.geometry.map(
              point => [
                point.lat,
                point.lon,
              ],
            )}
            pathOptions={{
              color: '#0d9488',
              weight: 5,
              opacity: 0.85,
            }}
          />
        )}
    </>
  );
}
