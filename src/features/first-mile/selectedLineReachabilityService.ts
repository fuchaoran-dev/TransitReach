import {
  computeReachability,
  DEPARTURE_TIME,
  type IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';
import {
  loadRailStops,
  type RailLine,
  type RailStop,
} from '@/shared/data/adapters/gtfsAdapter';
import {
  railLinePatternForRoute,
} from '@/shared/data/adapters/railLinePatternAdapter';

import {
  DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
} from './firstMileService';
import {
  clipReachabilityRegions,
  unionReachabilityRegions,
} from './clipReachabilityRegions';
import type {
  FirstMileStopResult,
} from './types';

const MALAYSIA_TIME_ZONE = 'Asia/Kuala_Lumpur';
const WALK_ISOCHRONE_CONCURRENCY = 4;

export interface SelectedLineReachableStop {
  stop: RailStop;
  rideSeconds: number;
  remainingJourneySeconds: number;
  egressWalkingMinutes: number;
}

export interface SelectedLineReachabilityResult {
  regions: IsochroneRegion[];
  reachableStops: SelectedLineReachableStop[];
  modelledWaitSeconds: number;
  firstMileSeconds: number;
}

interface SelectedLineReachabilityInput {
  selectedStation: FirstMileStopResult;
  selectedLine: RailLine;
  totalBudgetMinutes: number;
  totalReachabilityRegions: IsochroneRegion[];
  signal: AbortSignal;
  departureTime?: string;
}

function addSeconds(
  isoTime: string,
  seconds: number,
): string {
  const parsed = new Date(isoTime);

  if (Number.isNaN(parsed.getTime())) {
    return isoTime;
  }

  return new Date(
    parsed.getTime() + Math.max(0, seconds) * 1000,
  ).toISOString();
}

function gtfsSeconds(value: string): number {
  const [hours, minutes, seconds = 0] = value
    .split(':')
    .map(Number);

  return hours * 3600 + minutes * 60 + seconds;
}

function localDateParts(isoTime: string): {
  serviceId: string;
  secondsSinceMidnight: number;
} | null {
  const parsed = new Date(isoTime);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MALAYSIA_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(parsed)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );

  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  const serviceId =
    values.weekday === 'Sat'
      ? 'Sat'
      : values.weekday === 'Sun'
        ? 'Sun'
        : 'MonFri';

  return {
    serviceId,
    secondsSinceMidnight:
      hour * 3600 + minute * 60 + second,
  };
}

/**
 * The feed is frequency based rather than a published fixed timetable. For selected-line
 * reachability we model boarding wait as half the published headway for the active window.
 * This is deterministic and neutral: it is an analysis assumption, not a live arrival.
 */
function modelledWaitSeconds(
  line: RailLine,
  stationArrivalTime: string,
): number | null {
  if (!line.frequency) {
    return 0;
  }

  const local = localDateParts(stationArrivalTime);
  if (!local) {
    return Math.ceil(line.frequency.maxHeadwaySeconds / 2);
  }

  const activeWindow = line.frequency.windows.find(window => {
    if (window.serviceId !== local.serviceId) return false;

    const start = gtfsSeconds(window.startTime);
    const end = gtfsSeconds(window.endTime);

    return (
      local.secondsSinceMidnight >= start &&
      local.secondsSinceMidnight < end
    );
  });

  if (!activeWindow) {
    // No frequency window means the selected line is not modelled as operating at
    // this time. Returning null prevents us from drawing an impossible corridor.
    return null;
  }

  return Math.ceil(activeWindow.headwaySeconds / 2);
}

function downstreamRideTimes(
  routeId: string,
  boardingStationId: string,
): Map<string, number> {
  const pattern = railLinePatternForRoute(routeId);
  const result = new Map<string, number>();

  if (!pattern) {
    return result;
  }

  for (const direction of pattern.directions) {
    const boardingIndex = direction.stops.findIndex(
      stop => stop.stationId === boardingStationId,
    );

    if (boardingIndex < 0) {
      continue;
    }

    const boardingStop = direction.stops[boardingIndex];

    // Start at +1 deliberately: clicking a line means the area should represent places
    // reached after actually boarding that line, not a large walk-only blob around the
    // boarding station itself.
    for (let index = boardingIndex + 1; index < direction.stops.length; index++) {
      const destination = direction.stops[index];
      const rideSeconds = Math.max(
        0,
        destination.arrivalOffsetSeconds -
          boardingStop.departureOffsetSeconds,
      );

      const previous = result.get(destination.stationId);
      if (previous === undefined || rideSeconds < previous) {
        result.set(destination.stationId, rideSeconds);
      }
    }
  }

  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;

      try {
        const value = await worker(items[index]);
        results[index] = {
          status: 'fulfilled',
          value,
        };
      } catch (reason) {
        results[index] = {
          status: 'rejected',
          reason,
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker(),
    ),
  );

  return results;
}

/**
 * Computes the area reachable specifically via the selected rail/BRT line.
 *
 * Model:
 *   origin -> actual first-mile walk -> selected station
 *          -> modelled wait from published headway
 *          -> selected line only (no transfer to another line)
 *          -> practical walking egress from reachable downstream stations
 *
 * Egress walking is capped at the same 15-minute practical threshold used by first-mile
 * access. This keeps the layer a line-served corridor rather than a huge walk-only area.
 */
export async function computeSelectedLineReachability({
  selectedStation,
  selectedLine,
  totalBudgetMinutes,
  totalReachabilityRegions,
  signal,
  departureTime = DEPARTURE_TIME,
}: SelectedLineReachabilityInput): Promise<SelectedLineReachabilityResult> {
  const firstMileSeconds = Math.max(
    0,
    selectedStation.route.durationSeconds,
  );
  const totalBudgetSeconds = Math.max(
    0,
    totalBudgetMinutes * 60,
  );

  if (firstMileSeconds >= totalBudgetSeconds) {
    return {
      regions: [],
      reachableStops: [],
      modelledWaitSeconds: 0,
      firstMileSeconds,
    };
  }

  const stationArrivalTime = addSeconds(
    departureTime,
    firstMileSeconds,
  );
  const waitSeconds = modelledWaitSeconds(
    selectedLine,
    stationArrivalTime,
  );

  if (waitSeconds === null) {
    return {
      regions: [],
      reachableStops: [],
      modelledWaitSeconds: 0,
      firstMileSeconds,
    };
  }

  const rideTimes = downstreamRideTimes(
    selectedLine.routeId,
    selectedStation.stop.stopId,
  );
  const stopsById = new Map(
    loadRailStops().map(stop => [stop.stopId, stop]),
  );

  const reachableStops: SelectedLineReachableStop[] = [];

  for (const [stationId, rideSeconds] of rideTimes) {
    const stop = stopsById.get(stationId);
    if (!stop) continue;

    const remainingJourneySeconds =
      totalBudgetSeconds -
      firstMileSeconds -
      waitSeconds -
      rideSeconds;

    if (remainingJourneySeconds < 60) {
      continue;
    }

    const egressWalkingMinutes = Math.min(
      DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
      Math.floor(remainingJourneySeconds / 60),
    );

    if (egressWalkingMinutes <= 0) {
      continue;
    }

    reachableStops.push({
      stop,
      rideSeconds,
      remainingJourneySeconds,
      egressWalkingMinutes,
    });
  }

  reachableStops.sort(
    (a, b) =>
      a.rideSeconds - b.rideSeconds ||
      a.stop.name.localeCompare(b.stop.name),
  );

  const settled = await mapWithConcurrency(
    reachableStops,
    WALK_ISOCHRONE_CONCURRENCY,
    async reachable => {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const egressStartTime = addSeconds(
        stationArrivalTime,
        waitSeconds + reachable.rideSeconds,
      );

      const { result } = await computeReachability(
        {
          lat: reachable.stop.lat,
          lon: reachable.stop.lon,
        },
        reachable.egressWalkingMinutes,
        signal,
        egressStartTime,
        'walking',
      );

      return result.regions;
    },
  );

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const successfulRegionGroups = settled
    .filter(
      (
        item,
      ): item is PromiseFulfilledResult<IsochroneRegion[]> =>
        item.status === 'fulfilled',
    )
    .map(item => item.value)
    .filter(regions => regions.length > 0);

  const merged = unionReachabilityRegions(
    successfulRegionGroups,
  );

  const clipped =
    totalReachabilityRegions.length > 0
      ? clipReachabilityRegions(
          merged,
          totalReachabilityRegions,
        )
      : merged;

  return {
    regions: clipped,
    reachableStops,
    modelledWaitSeconds: waitSeconds,
    firstMileSeconds,
  };
}
