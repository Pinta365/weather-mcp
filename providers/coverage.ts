import type { Coordinates } from "./types.ts";

export type CoverageFn = (coords: Coordinates) => boolean;

export const everywhere: CoverageFn = () => true;

export function boundingBox(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): CoverageFn {
  return (coords) =>
    coords.latitude >= minLat && coords.latitude <= maxLat &&
    coords.longitude >= minLon && coords.longitude <= maxLon;
}
