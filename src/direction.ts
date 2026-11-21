import type { DirOctant } from './types';

/** Fixed 8-direction sequence: n, ne, e, se, s, sw, w, nw. */
export const OCTANT_ORDER: DirOctant[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Normalize any angle into [0, 360). */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Initial great-circle bearing from (fromLat, fromLng) to (toLat, toLng), in [0, 360). */
export function initialBearing(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const dLambda = toRad(toLng - fromLng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Which octant the target sits in, relative to the user's heading.
 * rel = normalize(bearing - heading); 45° windows, lower-inclusive:
 * [337.5,22.5)→n; [22.5,67.5)→ne; … wrapping around all 8 octants.
 */
export function octantFor(bearingDeg: number, headingDeg: number): DirOctant {
  const rel = normalizeAngle(bearingDeg - headingDeg);
  const idx = Math.floor(normalizeAngle(rel + 22.5) / 45) % 8;
  return OCTANT_ORDER[idx];
}
