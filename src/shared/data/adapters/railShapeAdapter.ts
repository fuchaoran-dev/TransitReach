import rawShapes
  from '@/shared/data/rail/shapes.json';

export interface RailShapePoint {
  lat: number;
  lon: number;
}

export interface RailShape {
  shapeId: string;
  points:
    RailShapePoint[];
}

const RAIL_SHAPES =
  rawShapes as Record<
    string,
    RailShape
  >;

export function railShapeForRoute(
  routeId: string,
): RailShape | null {
  return (
    RAIL_SHAPES[
      routeId
    ] ?? null
  );
}