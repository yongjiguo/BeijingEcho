import type { Fix, Spot } from './types';

export const ACCURACY_MAX_METERS = 100;
export const COOLDOWN_MS = 30 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function isInsideFence(spot: Spot, lat: number, lng: number): boolean {
  return haversineMeters(spot.lat, spot.lng, lat, lng) <= spot.radiusMeters;
}

export function isAccurate(fix: Fix, maxMeters: number = ACCURACY_MAX_METERS): boolean {
  const acc = fix.accuracy;
  return typeof acc === 'number' && Number.isFinite(acc) && acc > 0 && acc <= maxMeters;
}

export function pickNearestInside(spots: Spot[], lat: number, lng: number): Spot | null {
  let best: Spot | null = null;
  let bestDist = Infinity;
  for (const spot of spots) {
    if (!isInsideFence(spot, lat, lng)) continue;
    const d = haversineMeters(spot.lat, spot.lng, lat, lng);
    if (d < bestDist) {
      best = spot;
      bestDist = d;
    }
  }
  return best;
}

export class Cooldowns {
  private readonly marked = new Map<string, number>();

  mark(id: string, now: number = Date.now()): void {
    this.marked.set(id, now);
  }

  isCooling(id: string, now: number = Date.now()): boolean {
    const at = this.marked.get(id);
    if (at === undefined) return false;
    return now - at < COOLDOWN_MS;
  }

  reset(): void {
    this.marked.clear();
  }
}

export type FixCallback = (fix: Fix) => void;

/** Wraps browser geolocation. `setMock` (test mode) replaces the real feed entirely. */
export class GeoWatcher {
  private cb: FixCallback | null = null;
  private watchId: number | null = null;
  private mock: Fix | null = null;

  start(cb: FixCallback): void {
    this.cb = cb;
    if (this.mock) {
      this.emit(this.mock);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn('Geolocation unavailable in this environment');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.cb?.({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => console.warn('geolocation error:', err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  stop(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.cb = null;
  }

  /** Test mode: feed a synthetic fix (accuracy reported as at least 5 m). Pass null to resume real GPS. */
  setMock(fix: Fix | null): void {
    this.mock = fix;
    if (fix) this.emit(fix);
  }

  private emit(fix: Fix): void {
    this.cb?.({ ...fix, accuracy: Math.max(fix.accuracy, 5) });
  }
}
