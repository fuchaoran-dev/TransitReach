import {
  useEffect,
  useState,
} from 'react';

import {
  computeReachability,
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
    }
  | {
      status: 'failed';
    };

export function useStationReachability(
  station: StationPoint | null,
  timeBudget: number,
) {
  const [
    state,
    setState,
  ] =
    useState<StationReachabilityState>({
      status: 'idle',
    });

  useEffect(() => {
    if (!station || timeBudget <= 0) {
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
      timeBudget,
      controller.signal,
    )
      .then(({ result }) => {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        setState({
          status: 'ready',
          regions:
            result.regions,
        });
      })
      .catch(error => {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        console.error(
          'Station reachability failed',
          error,
        );

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
    timeBudget,
  ]);

  return state;
}