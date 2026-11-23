import type { Fix } from './types';
import { haversineMeters } from './geo';
import { initialBearing, normalizeAngle } from './direction';

const FILTER_WINDOW_MS = 2000;
const FILTER_MIN_SAMPLES = 3;
const TRACK_MIN_STEP_M = 5;

type OrientationWithWebkit = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Extract a compass heading from a DeviceOrientationEvent; null when unavailable. */
export function headingFromDeviceOrientation(evt: DeviceOrientationEvent): number | null {
  const webkit = (evt as OrientationWithWebkit).webkitCompassHeading;
  if (typeof webkit === 'number' && Number.isFinite(webkit)) return normalizeAngle(webkit);
  if (evt.absolute && evt.alpha != null && Number.isFinite(evt.alpha)) {
    return normalizeAngle(360 - evt.alpha);
  }
  return null;
}

/** ~2s sliding window; median of samples; null until at least 3 samples. */
export class MedianHeadingFilter {
  private samples: Array<{ deg: number; at: number }> = [];

  push(deg: number, now: number = Date.now()): number | null {
    this.samples.push({ deg, at: now });
    this.samples = this.samples.filter((s) => now - s.at <= FILTER_WINDOW_MS);
    if (this.samples.length < FILTER_MIN_SAMPLES) return null;
    const sorted = this.samples.map((s) => s.deg).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
}

export type HeadingCallback = (heading: number) => void;

/**
 * Wraps browser orientation events (iOS webkitCompassHeading, Android deviceorientationabsolute).
 * Real readings pass through a median filter; `setMock` (test mode) replaces the feed entirely.
 */
export class CompassWatcher {
  private cb: HeadingCallback | null = null;
  private filter = new MedianHeadingFilter();
  private last: number | null = null;
  private mock: number | null = null;
  private listening = false;

  start(cb: HeadingCallback): void {
    this.cb = cb;
    if (this.mock != null) {
      this.emit(this.mock);
      return;
    }
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      console.warn('Device orientation unavailable in this environment');
      return;
    }
    window.addEventListener('deviceorientation', this.onEvent);
    window.addEventListener('deviceorientationabsolute', this.onEvent as EventListener);
    this.listening = true;
  }

  stop(): void {
    if (this.listening && typeof window !== 'undefined') {
      window.removeEventListener('deviceorientation', this.onEvent);
      window.removeEventListener('deviceorientationabsolute', this.onEvent as EventListener);
    }
    this.listening = false;
    this.cb = null;
  }

  /** Test mode: feed a synthetic heading. Pass null to resume real sensors. */
  setMock(heading: number | null): void {
    this.mock = heading;
    if (heading != null) this.emit(heading);
    else this.last = null;
  }

  /** Latest accepted heading, or null. */
  heading(): number | null {
    return this.last;
  }

  private onEvent = (e: Event): void => {
    const h = headingFromDeviceOrientation(e as DeviceOrientationEvent);
    if (h == null) return;
    const filtered = this.filter.push(h);
    if (filtered != null) this.emit(filtered);
  };

  private emit(h: number): void {
    this.last = h;
    this.cb?.(h);
  }
}

/** Heading derived from GPS track: two consecutive fixes >=5m apart give a bearing. */
export class GpsTrackHeading {
  private lastFix: Fix | null = null;
  private last: number | null = null;
  private mock: number | null = null;

  /** Test mode: inject a synthetic track heading (normalized). Pass null to resume real math. */
  setMock(deg: number | null): void {
    this.mock = deg == null ? null : normalizeAngle(deg);
    this.last = this.mock;
    if (this.mock == null) this.lastFix = null;
  }

  update(fix: Fix): number | null {
    if (this.mock != null) {
      this.lastFix = fix;
      return this.last;
    }
    if (this.lastFix) {
      const d = haversineMeters(this.lastFix.lat, this.lastFix.lng, fix.lat, fix.lng);
      if (d >= TRACK_MIN_STEP_M) {
        this.last = initialBearing(this.lastFix.lat, this.lastFix.lng, fix.lat, fix.lng);
        this.lastFix = fix;
      }
    } else {
      this.lastFix = fix;
    }
    return this.last;
  }

  /** Latest track-derived heading, or null. */
  heading(): number | null {
    return this.last;
  }
}

/** Compass-filtered heading first; GPS track fallback; else null. */
export class HeadingResolver {
  constructor(
    private readonly compass: CompassWatcher,
    private readonly track: GpsTrackHeading,
  ) {}

  heading(): number | null {
    return this.compass.heading() ?? this.track.heading() ?? null;
  }
}
