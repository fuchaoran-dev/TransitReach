import {
  useEffect,
  useState,
} from 'react';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';
import type {
  RailLine,
} from '@/shared/data/adapters/gtfsAdapter';

import {
  computeSelectedLineReachability,
  type SelectedLineReachableStop,
} from '../selectedLineReachabilityService';
import type {
  FirstMileStopResult,
} from '../types';

export type SelectedLineReachabilityState =
  | {
      status: 'idle';
    }
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      regions: IsochroneRegion[];
      reachableStops: SelectedLineReachableStop[];
      modelledWaitSeconds: number;
    }
  | {
      status: 'failed';
      message: string;
    };

/**
 * React lifecycle wrapper for reachability through one explicitly selected line.
 * Changing station, line, budget or main isochrone aborts the previous computation.
 */
export function useSelectedLineReachability(
  selectedStation: FirstMileStopResult | null,
  selectedLine: RailLine | null,
  totalBudgetMinutes: number,
  totalReachabilityRegions: IsochroneRegion[],
): SelectedLineReachabilityState {
  const [state, setState] =
    useState<SelectedLineReachabilityState>({
      status: 'idle',
    });

  useEffect(() => {
    if (
      !selectedStation ||
      !selectedLine ||
      totalBudgetMinutes <= 0 ||
      totalReachabilityRegions.length === 0
    ) {
      setState({
        status: 'idle',
      });
      return;
    }

    const controller = new AbortController();

    setState({
      status: 'loading',
    });

    computeSelectedLineReachability({
      selectedStation,
      selectedLine,
      totalBudgetMinutes,
      totalReachabilityRegions,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return;

        setState({
          status: 'ready',
          regions: result.regions,
          reachableStops: result.reachableStops,
          modelledWaitSeconds: result.modelledWaitSeconds,
        });
      })
      .catch(error => {
        if (controller.signal.aborted) return;

        setState({
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not calculate selected-line reachability.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    selectedStation,
    selectedLine,
    totalBudgetMinutes,
    totalReachabilityRegions,
  ]);

  return state;
}
