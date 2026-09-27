import {
  useEffect,
  useRef,
  useState,
} from 'react';

import L from 'leaflet';

import {
  Marker,
  Popup,
} from 'react-leaflet';

import type {
  LiveTransitVehicle,
} from '../liveTransitService';

interface Props {
  vehicles:
    LiveTransitVehicle[];
}

/**
 * How long a bus takes to slide to its newly reported position.
 *
 * Short on purpose. Gliding across the whole 30-second poll would draw the bus on a
 * straight line between two reports, cutting through buildings at every turn — a
 * position that was never reported. A brief slide only replaces the jump, so the eye
 * can follow which bus moved where.
 */
const GLIDE_MS = 1_500;

/** How often report ages are re-read, so icons fade and popups count up. */
const AGE_TICK_MS = 5_000;

/**
 * Report age bands. The feed's positions are typically 30–60 s old when fetched, so
 * anything past a minute is visibly older than usual and past two minutes is stale.
 */
const AGED_AFTER_S = 60;
const STALE_AFTER_S = 120;

function iconFor(
  opacity: number,
): L.DivIcon {
  return L.divIcon({
    className:
      'live-transit-marker',

    html: `
      <div class="live-transit-marker-inner" style="opacity:${opacity}">
        🚌
      </div>
    `,

    iconSize: [32, 32],

    iconAnchor: [16, 16],

    popupAnchor: [0, -16],
  });
}

const ICONS = {
  fresh: iconFor(1),
  aged: iconFor(0.7),
  stale: iconFor(0.45),
};

function iconForAge(
  ageSeconds: number | null,
): L.DivIcon {
  if (ageSeconds === null || ageSeconds > STALE_AFTER_S) return ICONS.stale;
  if (ageSeconds > AGED_AFTER_S) return ICONS.aged;
  return ICONS.fresh;
}

function reportAgeSeconds(
  timestamp: number | null,
  nowMs: number,
): number | null {
  if (!timestamp) return null;
  // A device clock slightly behind the feed's would otherwise show a negative age.
  return Math.max(0, Math.round(nowMs / 1000 - timestamp));
}

function formatAge(
  ageSeconds: number | null,
): string {
  if (ageSeconds === null) return 'Unknown';
  if (ageSeconds < 90) return `${ageSeconds} s ago`;
  return `${Math.round(ageSeconds / 60)} min ago`;
}

function formatTimestamp(
  timestamp: number | null,
): string {
  if (!timestamp) {
    return 'Unknown';
  }

  return new Date(
    timestamp * 1000,
  ).toLocaleTimeString(
    'en-MY',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    },
  );
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One bus. Its position is moved imperatively so a new report can be animated to:
 * react-leaflet would otherwise set the new position in a single step. The `position`
 * prop is only the first one, captured once and never changed.
 */
function GlidingBusMarker({
  vehicle,
  nowMs,
}: {
  vehicle: LiveTransitVehicle;
  nowMs: number;
}) {
  const markerRef =
    useRef<L.Marker | null>(null);

  const [initialPosition] =
    useState<[number, number]>(
      () => [vehicle.lat, vehicle.lon],
    );

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const from = marker.getLatLng();
    const to = L.latLng(vehicle.lat, vehicle.lon);
    if (from.equals(to)) return;

    if (prefersReducedMotion()) {
      marker.setLatLng(to);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      // Ease-out: quick to leave the old spot, gentle into the reported one.
      const k = 1 - (1 - t) ** 3;
      marker.setLatLng([
        from.lat + (to.lat - from.lat) * k,
        from.lng + (to.lng - from.lng) * k,
      ]);
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    // A newer report mid-glide starts its own glide from wherever the bus is now.
    return () => cancelAnimationFrame(frame);
  }, [vehicle.lat, vehicle.lon]);

  const ageSeconds =
    reportAgeSeconds(vehicle.timestamp, nowMs);

  return (
    <Marker
      ref={markerRef}
      position={initialPosition}
      icon={iconForAge(ageSeconds)}
      zIndexOffset={500}
    >
      <Popup>
        <div className="min-w-[180px]">
          <div className="font-bold text-slate-800">
            Rapid KL Bus
          </div>

          <div className="text-xs text-slate-500 mt-1">
            Live GTFS-Realtime
          </div>

          <div className="mt-3 space-y-1 text-sm">
            <div>
              <strong>
                Route:
              </strong>{' '}
              {vehicle.routeId ??
                'Unknown'}
            </div>

            <div>
              <strong>
                Vehicle:
              </strong>{' '}
              {vehicle.id}
            </div>

            {vehicle
              .distanceToAccessibleStopMeters !==
              null && (
              <div>
                <strong>
                  Near accessible station:
                </strong>{' '}
                {Math.round(
                  vehicle
                    .distanceToAccessibleStopMeters,
                )}{' '}
                m
              </div>
            )}

            <div>
              <strong>
                Position reported:
              </strong>{' '}
              {formatAge(ageSeconds)}{' '}
              <span className="text-slate-400">
                ({formatTimestamp(
                  vehicle.timestamp,
                )})
              </span>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 mt-3">
            The bus has moved on since this report. Faded icons are older reports.
            Source: Prasarana via data.gov.my
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

export function LiveTransitMapLayer({
  vehicles,
}: Props) {
  const [nowMs, setNowMs] =
    useState(() => Date.now());

  useEffect(() => {
    const interval =
      window.setInterval(
        () => setNowMs(Date.now()),
        AGE_TICK_MS,
      );

    return () =>
      window.clearInterval(interval);
  }, []);

  return (
    <>
      {vehicles.map(
        vehicle => (
          <GlidingBusMarker
            key={vehicle.id}
            vehicle={vehicle}
            nowMs={nowMs}
          />
        ),
      )}
    </>
  );
}
