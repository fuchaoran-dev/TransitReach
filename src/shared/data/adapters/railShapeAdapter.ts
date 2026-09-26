import { databaseData } from '@/shared/data/databaseData';

export interface RailShapePoint {
  lat: number;
  lon: number;
}

export interface RailShape {
  shapeId: string;
  points:
    RailShapePoint[];
}

export function railShapeForRoute(
  routeId: string,
): RailShape | null {
  return (
    (databaseData().railShapes as Record<string, RailShape>)[
      routeId
    ] ?? null
  );
}
