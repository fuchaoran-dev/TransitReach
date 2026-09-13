import {
  useEffect,
  useState,
} from 'react';

import {
  fetchLiveTransitVehicles,
  vehiclesNearAccessibleStops,
  type LiveTransitVehicle,
} from '../liveTransitService';

interface AccessibleStopLike {
  stop: {
    lat: number;
    lon: number;
  };
}

export type LiveTransitState =
  | {
      status: 'idle';
      vehicles: [];
      lastUpdatedAt: null;
    }
  | {
      status: 'loading';
      vehicles:
        LiveTransitVehicle[];
      lastUpdatedAt:
        number | null;
    }
  | {
      status: 'ready';
      vehicles:
        LiveTransitVehicle[];
      lastUpdatedAt: number;
    }
  | {
      status: 'error';
      vehicles:
        LiveTransitVehicle[];
      lastUpdatedAt:
        number | null;
      message: string;
    };

const REFRESH_INTERVAL_MS =
  30_000;

/**
 * US 3.2 — Live Transit Activity Around Accessible Stops.
 *
 * Polls the official Rapid KL GTFS-Realtime feed every
 * 30 seconds and keeps only vehicles close to stops
 * already proven accessible by Epic 3.
 */
export function useLiveTransit(
  accessibleStops:
    AccessibleStopLike[],
  enabled = true,
) {
  const [
    state,
    setState,
  ] =
    useState<LiveTransitState>({
      status: 'idle',
      vehicles: [],
      lastUpdatedAt: null,
    });

  useEffect(() => {
    if (
      !enabled ||
      accessibleStops.length === 0
    ) {
      // Only write when there is something to change. Setting a fresh idle object
      // unconditionally re-renders the caller, which re-runs this effect if the caller
      // passes an unstable dependency — a loop that is cheap to make impossible here.
      setState(previous =>
        previous.status === 'idle' &&
        previous.vehicles.length === 0
          ? previous
          : {
              status: 'idle',
              vehicles: [],
              lastUpdatedAt: null,
            },
      );

      return;
    }

    let disposed = false;

    let controller:
      AbortController | null =
        null;

    const refresh =
      async () => {
        controller?.abort();

        controller =
          new AbortController();

        setState(previous => ({
          status: 'loading',
          vehicles:
            previous.vehicles,
          lastUpdatedAt:
            previous.lastUpdatedAt,
        }));

        try {
          const allVehicles =
            await fetchLiveTransitVehicles(
              controller.signal,
            );

          const nearby =
            vehiclesNearAccessibleStops(
              allVehicles,
              accessibleStops,
            );

          if (disposed) return;

          setState({
            status: 'ready',
            vehicles: nearby,
            lastUpdatedAt:
              Date.now(),
          });
        } catch (error) {
          if (
            controller
              .signal
              .aborted ||
            disposed
          ) {
            return;
          }

          setState(
            previous => ({
              status: 'error',
              vehicles:
                previous.vehicles,
              lastUpdatedAt:
                previous.lastUpdatedAt,
              message:
                error instanceof
                Error
                  ? error.message
                  : 'Live transit information unavailable.',
            }),
          );
        }
      };

    void refresh();

    const interval =
      window.setInterval(
        () => {
          void refresh();
        },
        REFRESH_INTERVAL_MS,
      );

    return () => {
      disposed = true;

      controller?.abort();

      window.clearInterval(
        interval,
      );
    };
  }, [
    accessibleStops,
    enabled,
  ]);

  return state;
}