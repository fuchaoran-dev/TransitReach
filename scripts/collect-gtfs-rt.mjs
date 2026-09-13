import fs from 'node:fs';
import path from 'node:path';

import GtfsRealtimeBindings
  from 'gtfs-realtime-bindings';


/* =========================================================
 * Configuration
 * ========================================================= */

const GTFS_RT_URL =
  'https://api.data.gov.my' +
  '/gtfs-realtime/vehicle-position/prasarana/' +
  '?category=rapid-bus-kl';

/*
 * ML collection interval.
 *
 * 60 seconds is enough for the initial
 * two-week proof-of-concept dataset.
 */
const COLLECTION_INTERVAL_MS =
  60_000;

/*
 * Do not allow a request to hang forever.
 */
const REQUEST_TIMEOUT_MS =
  15_000;


const OUTPUT_DIRECTORY =
  path.resolve(
    'data/ml',
  );

const SNAPSHOT_FILE =
  path.join(
    OUTPUT_DIRECTORY,
    'gtfs_rt_snapshots.csv',
  );

const VEHICLE_FILE =
  path.join(
    OUTPUT_DIRECTORY,
    'vehicle_positions.csv',
  );


/* =========================================================
 * CSV columns
 * ========================================================= */

const SNAPSHOT_COLUMNS = [
  'snapshot_id',
  'collected_at',
  'http_status',
  'feed_status',
  'entity_count',
  'vehicle_count',
  'feed_timestamp',
  'response_bytes',
  'duration_ms',
  'error_message',
];

const VEHICLE_COLUMNS = [
  'snapshot_id',
  'collected_at',
  'feed_timestamp',

  'entity_id',
  'vehicle_id',
  'route_id',
  'trip_id',

  'lat',
  'lon',

  'bearing',
  'speed_mps',

  'vehicle_timestamp',
];


/* =========================================================
 * Setup
 * ========================================================= */

fs.mkdirSync(
  OUTPUT_DIRECTORY,
  {
    recursive: true,
  },
);


function ensureCsvFile(
  filePath,
  columns,
) {
  const exists =
    fs.existsSync(
      filePath,
    );

  if (
    !exists ||
    fs.statSync(filePath).size === 0
  ) {
    fs.writeFileSync(
      filePath,
      `${columns.join(',')}\n`,
      'utf8',
    );
  }
}


ensureCsvFile(
  SNAPSHOT_FILE,
  SNAPSHOT_COLUMNS,
);

ensureCsvFile(
  VEHICLE_FILE,
  VEHICLE_COLUMNS,
);


/* =========================================================
 * Helpers
 * ========================================================= */

function numericValue(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === 'number'
  ) {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (
    typeof value === 'string'
  ) {
    const parsed =
      Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  /*
   * protobuf Long values may be
   * represented as objects.
   */
  if (
    typeof value === 'object' &&
    'toString' in value
  ) {
    const parsed =
      Number(
        String(value),
      );

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}


function csvEscape(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  const text =
    String(value);

  if (
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.replaceAll(
      '"',
      '""',
    )}"`;
  }

  return text;
}


function appendCsvRow(
  filePath,
  columns,
  data,
) {
  const row =
    columns
      .map(column =>
        csvEscape(
          data[column],
        ),
      )
      .join(',');

  fs.appendFileSync(
    filePath,
    `${row}\n`,
    'utf8',
  );
}


function createSnapshotId() {
  return (
    `${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2, 8)
  );
}


function sleep(
  milliseconds,
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}


/* =========================================================
 * Fetch with timeout
 * ========================================================= */

async function fetchWithTimeout(
  url,
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT_MS,
    );

  try {
    return await fetch(
      url,
      {
        signal:
          controller.signal,

        cache:
          'no-store',
      },
    );
  } finally {
    clearTimeout(
      timeout,
    );
  }
}


/* =========================================================
 * Snapshot writer
 * ========================================================= */

function saveSnapshot({
  snapshotId,
  collectedAt,
  httpStatus,
  feedStatus,
  entityCount,
  vehicleCount,
  feedTimestamp,
  responseBytes,
  durationMs,
  errorMessage,
}) {
  appendCsvRow(
    SNAPSHOT_FILE,
    SNAPSHOT_COLUMNS,
    {
      snapshot_id:
        snapshotId,

      collected_at:
        collectedAt,

      http_status:
        httpStatus,

      feed_status:
        feedStatus,

      entity_count:
        entityCount,

      vehicle_count:
        vehicleCount,

      feed_timestamp:
        feedTimestamp,

      response_bytes:
        responseBytes,

      duration_ms:
        durationMs,

      error_message:
        errorMessage,
    },
  );
}


/* =========================================================
 * Main collection
 * ========================================================= */

async function collectSnapshot() {
  const snapshotId =
    createSnapshotId();

  const collectedAt =
    new Date()
      .toISOString();

  const startedAt =
    Date.now();

  console.log(
    `\n[${collectedAt}] Collecting GTFS-RT...`,
  );

  let response;

  /*
   * -------------------------------------------------------
   * 1. Request API
   * -------------------------------------------------------
   */
  try {
    response =
      await fetchWithTimeout(
        GTFS_RT_URL,
      );
  } catch (error) {
    const durationMs =
      Date.now() -
      startedAt;

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const isTimeout =
      error instanceof Error &&
      error.name ===
        'AbortError';

    saveSnapshot({
      snapshotId,
      collectedAt,
      httpStatus:
        null,

      feedStatus:
        isTimeout
          ? 'TIMEOUT'
          : 'NETWORK_ERROR',

      entityCount:
        0,

      vehicleCount:
        0,

      feedTimestamp:
        null,

      responseBytes:
        0,

      durationMs,

      errorMessage:
        message,
    });

    console.error(
      'Request failed:',
      message,
    );

    return;
  }


  /*
   * -------------------------------------------------------
   * 2. HTTP error
   * -------------------------------------------------------
   */
  if (!response.ok) {
    const durationMs =
      Date.now() -
      startedAt;

    const status =
      response.status;

    const feedStatus =
      status === 429
        ? 'RATE_LIMITED'
        : 'HTTP_ERROR';

    saveSnapshot({
      snapshotId,
      collectedAt,

      httpStatus:
        status,

      feedStatus,

      entityCount:
        0,

      vehicleCount:
        0,

      feedTimestamp:
        null,

      responseBytes:
        0,

      durationMs,

      errorMessage:
        `HTTP ${status}`,
    });

    console.error(
      `HTTP error: ${status}`,
    );

    return;
  }


  /*
   * -------------------------------------------------------
   * 3. Read protobuf binary
   * -------------------------------------------------------
   */
  let binary;

  try {
    binary =
      new Uint8Array(
        await response.arrayBuffer(),
      );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    saveSnapshot({
      snapshotId,
      collectedAt,

      httpStatus:
        response.status,

      feedStatus:
        'READ_ERROR',

      entityCount:
        0,

      vehicleCount:
        0,

      feedTimestamp:
        null,

      responseBytes:
        0,

      durationMs:
        Date.now() -
        startedAt,

      errorMessage:
        message,
    });

    console.error(
      'Could not read response:',
      message,
    );

    return;
  }


  /*
   * -------------------------------------------------------
   * 4. Decode GTFS-Realtime
   * -------------------------------------------------------
   */
  let feed;

  try {
    feed =
      GtfsRealtimeBindings
        .transit_realtime
        .FeedMessage
        .decode(binary);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    saveSnapshot({
      snapshotId,
      collectedAt,

      httpStatus:
        response.status,

      feedStatus:
        'DECODE_ERROR',

      entityCount:
        0,

      vehicleCount:
        0,

      feedTimestamp:
        null,

      responseBytes:
        binary.byteLength,

      durationMs:
        Date.now() -
        startedAt,

      errorMessage:
        message,
    });

    console.error(
      'Protobuf decode failed:',
      message,
    );

    return;
  }


  /*
   * -------------------------------------------------------
   * 5. Feed metadata
   * -------------------------------------------------------
   */
  const feedTimestamp =
    numericValue(
      feed.header?.timestamp,
    );

  const entityCount =
    feed.entity.length;

  let vehicleCount =
    0;


  /*
   * -------------------------------------------------------
   * 6. Store each vehicle position
   * -------------------------------------------------------
   */
  for (
    const entity of
    feed.entity
  ) {
    const vehicle =
      entity.vehicle;

    const position =
      vehicle?.position;

    if (
      !vehicle ||
      !position
    ) {
      continue;
    }

    const lat =
      numericValue(
        position.latitude,
      );

    const lon =
      numericValue(
        position.longitude,
      );

    if (
      lat === null ||
      lon === null
    ) {
      continue;
    }


    const vehicleId =
      vehicle.vehicle?.id ??
      null;

    const routeId =
      vehicle.trip?.routeId ??
      null;

    const tripId =
      vehicle.trip?.tripId ??
      null;


    appendCsvRow(
      VEHICLE_FILE,
      VEHICLE_COLUMNS,
      {
        snapshot_id:
          snapshotId,

        collected_at:
          collectedAt,

        feed_timestamp:
          feedTimestamp,

        entity_id:
          entity.id ??
          null,

        vehicle_id:
          vehicleId,

        route_id:
          routeId,

        trip_id:
          tripId,

        lat,

        lon,

        bearing:
          numericValue(
            position.bearing,
          ),

        speed_mps:
          numericValue(
            position.speed,
          ),

        vehicle_timestamp:
          numericValue(
            vehicle.timestamp,
          ),
      },
    );

    vehicleCount += 1;
  }


  /*
   * -------------------------------------------------------
   * 7. Determine feed status
   * -------------------------------------------------------
   */

  let feedStatus;

  if (
    entityCount === 0
  ) {
    feedStatus =
      'EMPTY';
  } else if (
    vehicleCount === 0
  ) {
    feedStatus =
      'NO_VEHICLE_POSITIONS';
  } else {
    feedStatus =
      'OK';
  }


  /*
   * -------------------------------------------------------
   * 8. Save snapshot summary
   * -------------------------------------------------------
   */

  const durationMs =
    Date.now() -
    startedAt;

  saveSnapshot({
    snapshotId,
    collectedAt,

    httpStatus:
      response.status,

    feedStatus,

    entityCount,

    vehicleCount,

    feedTimestamp,

    responseBytes:
      binary.byteLength,

    durationMs,

    errorMessage:
      null,
  });


  console.log(
    [
      `Status: ${feedStatus}`,
      `entities=${entityCount}`,
      `vehicles=${vehicleCount}`,
      `bytes=${binary.byteLength}`,
      `time=${durationMs}ms`,
    ].join(' | '),
  );
}


/* =========================================================
 * Continuous collection loop
 * ========================================================= */

async function main() {
  console.log(
    '=========================================',
  );

  console.log(
    'Rapid KL GTFS-RT ML Data Collector',
  );

  console.log(
    '=========================================',
  );

  console.log(
    `Interval: ${
      COLLECTION_INTERVAL_MS /
      1000
    } seconds`,
  );

  console.log(
    `Snapshots: ${SNAPSHOT_FILE}`,
  );

  console.log(
    `Vehicles:  ${VEHICLE_FILE}`,
  );

  console.log(
    '\nPress Ctrl+C to stop.\n',
  );


  while (true) {
    try {
      await collectSnapshot();
    } catch (error) {
      /*
       * One unexpected error should
       * not terminate a two-week
       * collection process.
       */
      console.error(
        'Unexpected collector error:',
        error,
      );
    }

    await sleep(
      COLLECTION_INTERVAL_MS,
    );
  }
}


main().catch(error => {
  console.error(
    'Collector crashed:',
    error,
  );

  process.exitCode = 1;
});