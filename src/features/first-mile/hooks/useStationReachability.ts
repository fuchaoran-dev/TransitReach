import {
  useEffect,
  useState,
} from 'react';

import {
  computeReachability,
  DEPARTURE_TIME,
  type IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

interface StationPoint {
  lat: number;
  lon: number;
}

export type StationReachabilityState =
  | {
      status: 'idle';
    }
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      regions: IsochroneRegion[];
      budgetMinutes: number;
    }
  | {
      status: 'failed';
    };

/**
 * Computes a second reachability area from a selected first-mile station.
 *
 * This is intentionally separate from the main origin reachability area. It is only
 * enabled after the user explicitly selects a rail/BRT service from a first-mile stop.
 * The caller supplies the remaining journey budget and an adjusted departure time so
 * the secondary area does not pretend the user was already standing at the station at
 * the original departure time.
 */
export function useStationReachability(
  station: StationPoint | null,
  timeBudgetMinutes: number,
  departureTime = DEPARTURE_TIME,
) {
  const [state, setState] =
    useState<StationReachabilityState>({
      status: 'idle',
    });

  useEffect(() => {
    if (!station || timeBudgetMinutes <= 0) {
      setState({
        status: 'idle',
      });
      return;
    }

    const controller =
      new AbortController();

    setState({
      status: 'loading',
    });

    computeReachability(
      station,
      timeBudgetMinutes,
      controller.signal,
      departureTime,
    )
      .then(({ result }) => {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        setState({
          status: 'ready',
          regions: result.regions,
          budgetMinutes:
            timeBudgetMinutes,
        });
      })
      .catch(() => {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        setState({
          status: 'failed',
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    station?.lat,
    station?.lon,
    timeBudgetMinutes,
    departureTime,
  ]);

  return state;
}
