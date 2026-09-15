/**
 * OTP's TravelTime surface, decoded.
 *
 * The engine returns a single-band GeoTIFF: 32-bit signed seconds per pixel, LZW-compressed,
 * placed by a model transformation matrix. Only what that one producer writes is supported —
 * this is not a general TIFF reader, and a surface that uses anything else fails loudly rather
 * than being misread. A GeoTIFF library would handle more, at many times the size, for a format
 * that has exactly one source here.
 */

export interface TravelTimeSurface {
  width: number;
  height: number;
  /** Longitude and latitude of the top-left corner of pixel (0, 0). */
  originLon: number;
  originLat: number;
  lonPerPixel: number;
  /** Negative: rows run southwards. */
  latPerPixel: number;
  /** Seconds, row by row from the top. */
  seconds: Int32Array;
  noData: number;
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  stripByteCounts: 279,
  predictor: 317,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  transformation: 34264,
  gdalNoData: 42113,
} as const;

const COMPRESSION_NONE = 1;
const COMPRESSION_LZW = 5;
const SAMPLE_FORMAT_SIGNED = 2;

const CLEAR_CODE = 256;
const END_OF_INFORMATION = 257;
const MAX_CODE_LENGTH = 12;

/** TIFF's LZW variant: codes most-significant-bit first, 9 to 12 bits, widening one code early. */
function decodeLzw(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  let table: Uint8Array[] = [];
  let codeLength = 9;
  let bit = 0;
  let previous: Uint8Array | null = null;

  const resetTable = () => {
    table = Array.from({ length: 258 }, (_, i) => (i < 256 ? Uint8Array.of(i) : new Uint8Array(0)));
    codeLength = 9;
    previous = null;
  };
  const readCode = () => {
    if (bit + codeLength > input.length * 8) return END_OF_INFORMATION;
    let code = 0;
    for (let i = 0; i < codeLength; i++, bit++) {
      code = (code << 1) | ((input[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    return code;
  };
  const extend = (bytes: Uint8Array, last: number) => {
    const next = new Uint8Array(bytes.length + 1);
    next.set(bytes);
    next[bytes.length] = last;
    return next;
  };

  resetTable();
  for (;;) {
    const code = readCode();
    if (code === END_OF_INFORMATION) break;
    if (code === CLEAR_CODE) {
      resetTable();
      continue;
    }

    let entry: Uint8Array;
    if (code < table.length) entry = table[code];
    else if (code === table.length && previous) entry = extend(previous, previous[0]);
    else throw new Error('Travel-time surface: corrupt LZW data.');

    for (const byte of entry) output.push(byte);
    if (previous) table.push(extend(previous, entry[0]));
    previous = entry;

    if (table.length + 1 >= 1 << codeLength && codeLength < MAX_CODE_LENGTH) codeLength++;
  }
  return Uint8Array.from(output);
}

export function decodeTravelTimeSurface(buffer: ArrayBuffer): TravelTimeSurface {
  const view = new DataView(buffer);
  const littleEndian = view.getUint16(0) === 0x4949;
  if (view.getUint16(2, littleEndian) !== 42) throw new Error('Travel-time surface: not a TIFF.');

  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 };
  const tags = new Map<number, number[] | string>();
  const directory = view.getUint32(4, littleEndian);
  const entries = view.getUint16(directory, littleEndian);

  for (let i = 0; i < entries; i++) {
    const at = directory + 2 + i * 12;
    const tag = view.getUint16(at, littleEndian);
    const type = view.getUint16(at + 2, littleEndian);
    const count = view.getUint32(at + 4, littleEndian);
    const size = (typeSize[type] ?? 0) * count;
    if (size === 0) continue;
    const offset = size <= 4 ? at + 8 : view.getUint32(at + 8, littleEndian);

    if (type === 2) {
      const bytes = new Uint8Array(buffer, offset, count);
      tags.set(tag, String.fromCharCode(...bytes).replace(/\0+$/, ''));
      continue;
    }
    const values: number[] = [];
    for (let k = 0; k < count; k++) {
      const o = offset + k * typeSize[type];
      values.push(
        type === 1 ? view.getUint8(o)
          : type === 3 ? view.getUint16(o, littleEndian)
          : type === 4 ? view.getUint32(o, littleEndian)
          : view.getFloat64(o, littleEndian),
      );
    }
    tags.set(tag, values);
  }

  const numbers = (tag: number): number[] => {
    const value = tags.get(tag);
    return Array.isArray(value) ? value : [];
  };
  const width = numbers(TAG.width)[0];
  const height = numbers(TAG.height)[0];
  const compression = numbers(TAG.compression)[0] ?? COMPRESSION_NONE;

  if (numbers(TAG.bitsPerSample)[0] !== 32 || numbers(TAG.sampleFormat)[0] !== SAMPLE_FORMAT_SIGNED) {
    throw new Error('Travel-time surface: expected 32-bit signed samples.');
  }
  if ((numbers(TAG.samplesPerPixel)[0] ?? 1) !== 1) throw new Error('Travel-time surface: expected one band.');
  if ((numbers(TAG.predictor)[0] ?? 1) !== 1) throw new Error('Travel-time surface: predictors are not supported.');
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_LZW) {
    throw new Error(`Travel-time surface: compression ${compression} is not supported.`);
  }

  // Georeferencing: the transformation matrix OTP writes, or scale + tie point if a later version
  // switches to those.
  let originLon: number;
  let originLat: number;
  let lonPerPixel: number;
  let latPerPixel: number;
  const matrix = numbers(TAG.transformation);
  if (matrix.length === 16) {
    [lonPerPixel, , , originLon] = matrix;
    [, latPerPixel, , originLat] = matrix.slice(4);
  } else {
    const scale = numbers(TAG.pixelScale);
    const tie = numbers(TAG.tiepoint);
    if (scale.length < 2 || tie.length < 6) throw new Error('Travel-time surface: no georeferencing.');
    lonPerPixel = scale[0];
    latPerPixel = -scale[1];
    originLon = tie[3] - tie[0] * scale[0];
    originLat = tie[4] + tie[1] * scale[1];
  }

  const pixels = new Uint8Array(width * height * 4);
  const offsets = numbers(TAG.stripOffsets);
  const counts = numbers(TAG.stripByteCounts);
  let filled = 0;
  offsets.forEach((offset, strip) => {
    const raw = new Uint8Array(buffer, offset, counts[strip]);
    const bytes = compression === COMPRESSION_LZW ? decodeLzw(raw) : raw;
    const take = Math.min(bytes.length, pixels.length - filled);
    pixels.set(bytes.subarray(0, take), filled);
    filled += take;
  });
  if (filled !== pixels.length) throw new Error('Travel-time surface: image data is incomplete.');

  const samples = new DataView(pixels.buffer);
  const seconds = new Int32Array(width * height);
  for (let i = 0; i < seconds.length; i++) seconds[i] = samples.getInt32(i * 4, littleEndian);

  const noDataTag = tags.get(TAG.gdalNoData);
  const noData = typeof noDataTag === 'string' ? Number(noDataTag) : -2147483648;

  return { width, height, originLon, originLat, lonPerPixel, latPerPixel, seconds, noData };
}

/** Travel time to a point in minutes, or null where the surface says it is out of reach or off the grid. */
export function minutesAt(surface: TravelTimeSurface, lat: number, lon: number): number | null {
  const column = Math.floor((lon - surface.originLon) / surface.lonPerPixel);
  const row = Math.floor((lat - surface.originLat) / surface.latPerPixel);
  if (column < 0 || row < 0 || column >= surface.width || row >= surface.height) return null;
  const value = surface.seconds[row * surface.width + column];
  if (value === surface.noData || value < 0) return null;
  return value / 60;
}
