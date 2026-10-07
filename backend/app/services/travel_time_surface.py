from __future__ import annotations

from dataclasses import dataclass
from math import floor
from struct import unpack_from


@dataclass(frozen=True)
class TravelTimeSurface:
    width: int
    height: int
    origin_lon: float
    origin_lat: float
    lon_per_pixel: float
    lat_per_pixel: float
    seconds: tuple[int, ...]
    no_data: int


_TAGS = {
    "width": 256, "height": 257, "bits": 258, "compression": 259,
    "strip_offsets": 273, "samples": 277, "strip_counts": 279,
    "predictor": 317, "sample_format": 339, "pixel_scale": 33550,
    "tiepoint": 33922, "transformation": 34264, "no_data": 42113,
}
_TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 12: 8}


def _decode_lzw(data: bytes) -> bytes:
    output = bytearray()
    table: list[bytes] = []
    code_length = 9
    bit = 0
    previous: bytes | None = None

    def reset() -> None:
        nonlocal table, code_length, previous
        table = [bytes((value,)) for value in range(256)] + [b"", b""]
        code_length = 9
        previous = None

    def read_code() -> int:
        nonlocal bit
        if bit + code_length > len(data) * 8:
            return 257
        code = 0
        for _ in range(code_length):
            code = (code << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1)
            bit += 1
        return code

    reset()
    while True:
        code = read_code()
        if code == 257:
            break
        if code == 256:
            reset()
            continue
        if code < len(table):
            entry = table[code]
        elif code == len(table) and previous:
            entry = previous + previous[:1]
        else:
            raise ValueError("Travel-time surface contains corrupt LZW data.")
        output.extend(entry)
        if previous:
            table.append(previous + entry[:1])
        previous = entry
        if len(table) + 1 >= 1 << code_length and code_length < 12:
            code_length += 1
    return bytes(output)


def decode_travel_time_surface(data: bytes) -> TravelTimeSurface:
    """Decode the narrow GeoTIFF format produced by the pinned OTP 2.5 surface endpoint."""
    if len(data) < 8 or data[:2] not in {b"II", b"MM"}:
        raise ValueError("Travel-time surface is not a TIFF.")
    endian = "<" if data[:2] == b"II" else ">"
    if unpack_from(f"{endian}H", data, 2)[0] != 42:
        raise ValueError("Travel-time surface is not a TIFF.")
    directory = unpack_from(f"{endian}I", data, 4)[0]
    entries = unpack_from(f"{endian}H", data, directory)[0]
    tags: dict[int, list[float | int] | str] = {}

    for index in range(entries):
        at = directory + 2 + index * 12
        tag, value_type, count = unpack_from(f"{endian}HHI", data, at)
        type_size = _TYPE_SIZE.get(value_type)
        if type_size is None:
            continue
        size = type_size * count
        offset = at + 8 if size <= 4 else unpack_from(f"{endian}I", data, at + 8)[0]
        if value_type == 2:
            tags[tag] = data[offset:offset + count].rstrip(b"\0").decode("ascii")
            continue
        formats = {1: "B", 3: "H", 4: "I", 12: "d"}
        tags[tag] = [
            unpack_from(f"{endian}{formats[value_type]}", data, offset + item * type_size)[0]
            for item in range(count)
        ]

    def numbers(tag: int) -> list[float | int]:
        value = tags.get(tag, [])
        return value if isinstance(value, list) else []

    width = int(numbers(_TAGS["width"])[0])
    height = int(numbers(_TAGS["height"])[0])
    compression = int((numbers(_TAGS["compression"]) or [1])[0])
    if numbers(_TAGS["bits"])[0] != 32 or numbers(_TAGS["sample_format"])[0] != 2:
        raise ValueError("Travel-time surface must contain signed 32-bit samples.")
    if (numbers(_TAGS["samples"]) or [1])[0] != 1:
        raise ValueError("Travel-time surface must contain one band.")
    if (numbers(_TAGS["predictor"]) or [1])[0] != 1:
        raise ValueError("Travel-time surface predictors are unsupported.")
    if compression not in {1, 5}:
        raise ValueError(f"Travel-time surface compression {compression} is unsupported.")

    matrix = numbers(_TAGS["transformation"])
    if len(matrix) == 16:
        lon_per_pixel, origin_lon = float(matrix[0]), float(matrix[3])
        lat_per_pixel, origin_lat = float(matrix[5]), float(matrix[7])
    else:
        scale, tie = numbers(_TAGS["pixel_scale"]), numbers(_TAGS["tiepoint"])
        if len(scale) < 2 or len(tie) < 6:
            raise ValueError("Travel-time surface has no georeferencing.")
        lon_per_pixel, lat_per_pixel = float(scale[0]), -float(scale[1])
        origin_lon = float(tie[3]) - float(tie[0]) * lon_per_pixel
        origin_lat = float(tie[4]) + float(tie[1]) * float(scale[1])

    pixels = bytearray()
    offsets = numbers(_TAGS["strip_offsets"])
    counts = numbers(_TAGS["strip_counts"])
    for index, offset in enumerate(offsets):
        raw = data[int(offset):int(offset) + int(counts[index])]
        pixels.extend(_decode_lzw(raw) if compression == 5 else raw)
    expected = width * height * 4
    if len(pixels) < expected:
        raise ValueError("Travel-time surface image data is incomplete.")
    seconds = unpack_from(f"{endian}{width * height}i", pixels[:expected])
    raw_no_data = tags.get(_TAGS["no_data"])
    no_data = int(raw_no_data) if isinstance(raw_no_data, str) else -2147483648
    return TravelTimeSurface(
        width, height, origin_lon, origin_lat, lon_per_pixel, lat_per_pixel,
        tuple(seconds), no_data,
    )


def minutes_at(surface: TravelTimeSurface, latitude: float, longitude: float) -> float | None:
    column = floor((longitude - surface.origin_lon) / surface.lon_per_pixel)
    row = floor((latitude - surface.origin_lat) / surface.lat_per_pixel)
    if column < 0 or row < 0 or column >= surface.width or row >= surface.height:
        return None
    seconds = surface.seconds[row * surface.width + column]
    return None if seconds == surface.no_data or seconds < 0 else seconds / 60
