import fs from 'node:fs';
import path from 'node:path';

const inputPath =
  path.resolve(
    'data/gtfs/rapid-rail-kl/shapes.txt',
  );

const outputPath =
  path.resolve(
    'src/shared/data/rail/shapes.json',
  );

if (!fs.existsSync(inputPath)) {
  throw new Error(
    `Missing GTFS shapes file: ${inputPath}`,
  );
}

const raw =
  fs.readFileSync(
    inputPath,
    'utf8',
  );

const lines =
  raw
    .trim()
    .split(/\r?\n/);

const headers =
  lines[0]
    .split(',')
    .map(value =>
      value.trim(),
    );

const shapeIdIndex =
  headers.indexOf(
    'shape_id',
  );

const lonIndex =
  headers.indexOf(
    'shape_pt_lon',
  );

const latIndex =
  headers.indexOf(
    'shape_pt_lat',
  );

const sequenceIndex =
  headers.indexOf(
    'shape_pt_sequence',
  );

if (
  shapeIdIndex === -1 ||
  lonIndex === -1 ||
  latIndex === -1 ||
  sequenceIndex === -1
) {
  throw new Error(
    'Invalid shapes.txt header.',
  );
}

/*
 * shapes.txt uses MRT for the
 * Kajang Line, while the current
 * app uses KGL as its routeId.
 */
function routeIdFromShapeId(
  shapeId,
) {
  const match =
    shapeId.match(
      /^shp_(.+)_([01])$/,
    );

  if (!match) {
    return null;
  }

  const rawRouteId =
    match[1];

  if (
    rawRouteId === 'MRT'
  ) {
    return 'KGL';
  }

  return rawRouteId;
}

const shapes = {};

for (
  const row of
  lines.slice(1)
) {
  if (!row.trim()) {
    continue;
  }

  const values =
    row.split(',');

  const shapeId =
    values[
      shapeIdIndex
    ]?.trim();

  if (!shapeId) {
    continue;
  }

  /*
   * _0 and _1 are opposite
   * directions of the same line.
   *
   * We only need one geometry
   * for displaying the route.
   */
  if (
    !shapeId.endsWith(
      '_0',
    )
  ) {
    continue;
  }

  const routeId =
    routeIdFromShapeId(
      shapeId,
    );

  if (!routeId) {
    continue;
  }

  const lat =
    Number(
      values[latIndex],
    );

  const lon =
    Number(
      values[lonIndex],
    );

  const sequence =
    Number(
      values[
        sequenceIndex
      ],
    );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(
      sequence,
    )
  ) {
    continue;
  }

  if (!shapes[routeId]) {
    shapes[routeId] = {
      shapeId,
      points: [],
    };
  }

  shapes[
    routeId
  ].points.push({
    lat,
    lon,
    sequence,
  });
}

for (
  const shape of
  Object.values(shapes)
) {
  shape.points.sort(
    (a, b) =>
      a.sequence -
      b.sequence,
  );

  shape.points =
    shape.points.map(
      ({
        lat,
        lon,
      }) => ({
        lat,
        lon,
      }),
    );
}

fs.mkdirSync(
  path.dirname(
    outputPath,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  outputPath,
  JSON.stringify(
    shapes,
    null,
    2,
  ),
);

console.log(
  'Rail shapes built:',
  Object.keys(shapes),
);

console.log(
  `Output: ${outputPath}`,
);