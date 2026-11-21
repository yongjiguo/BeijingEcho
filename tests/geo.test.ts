import { describe, expect, it } from 'vitest';
import type { Fix, Spot } from '../src/types';
import {
  Cooldowns,
  GeoWatcher,
  haversineMeters,
  isAccurate,
  isInsideFence,
  pickNearestInside,
} from '../src/geo';

const TIANANMEN = { lat: 39.9042, lng: 116.4074 };
const TEMPLE_OF_HEAVEN = { lat: 39.8822, lng: 116.4066 };

function makeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: 'test-spot',
    name: 'Test Spot',
    summary: '',
    lat: 0,
    lng: 0,
    radiusMeters: 200,
    audio: 'audio/spot-test-spot.mp3',
    transcript: 'test',
    images: [],
    landmark: { name: 'L', lat: 0, lng: 0 },
    ...overrides,
  };
}

describe('haversineMeters', () => {
  it('computes Tiananmen → Temple of Heaven ≈ 2450m ±30', () => {
    const d = haversineMeters(
      TIANANMEN.lat,
      TIANANMEN.lng,
      TEMPLE_OF_HEAVEN.lat,
      TEMPLE_OF_HEAVEN.lng,
    );
    expect(Math.abs(d - 2450)).toBeLessThanOrEqual(30);
  });

  it('returns 0 for identical points', () => {
    expect(haversineMeters(39.9, 116.4, 39.9, 116.4)).toBe(0);
  });
});

describe('isInsideFence', () => {
  it('contains the spot center itself', () => {
    expect(isInsideFence(makeSpot(), 0, 0)).toBe(true);
  });

  it('contains a point at ~0.999 radius (≤ semantics)', () => {
    const spot = makeSpot({ lat: 39.9, lng: 116.4, radiusMeters: 200 });
    const dLat = (200 * 0.999) / 111195; // meters → degrees, meridional
    expect(isInsideFence(spot, spot.lat + dLat, spot.lng)).toBe(true);
  });

  it('rejects a point at ~1.001 radius', () => {
    const spot = makeSpot({ lat: 39.9, lng: 116.4, radiusMeters: 200 });
    const dLat = (200 * 1.001) / 111195;
    expect(isInsideFence(spot, spot.lat + dLat, spot.lng)).toBe(false);
  });
});

describe('isAccurate', () => {
  it('accepts 95m', () => {
    expect(isAccurate({ lat: 0, lng: 0, accuracy: 95 })).toBe(true);
  });

  it('rejects 101m', () => {
    expect(isAccurate({ lat: 0, lng: 0, accuracy: 101 })).toBe(false);
  });

  it('rejects NaN accuracy (unreliable, must not crash)', () => {
    const bad = { lat: 0, lng: 0, accuracy: NaN } as Fix;
    expect(isAccurate(bad)).toBe(false);
  });

  it('rejects 0 accuracy (unreliable device reading)', () => {
    expect(isAccurate({ lat: 0, lng: 0, accuracy: 0 })).toBe(false);
  });

  it('rejects undefined accuracy', () => {
    const bad = { lat: 0, lng: 0 } as Fix;
    expect(isAccurate(bad)).toBe(false);
  });
});

describe('Cooldowns', () => {
  it('is cooling right after mark', () => {
    const c = new Cooldowns();
    c.mark('spot-a', 1_000_000);
    expect(c.isCooling('spot-a', 1_000_000 + 1)).toBe(true);
  });

  it('expires after 30 minutes', () => {
    const c = new Cooldowns();
    const now = 1_000_000;
    c.mark('spot-a', now);
    expect(c.isCooling('spot-a', now + 30 * 60 * 1000 - 1)).toBe(true);
    expect(c.isCooling('spot-a', now + 30 * 60 * 1000)).toBe(false);
  });

  it('tracks spots independently and reset clears all', () => {
    const c = new Cooldowns();
    c.mark('a', 0);
    expect(c.isCooling('b', 0)).toBe(false);
    c.reset();
    expect(c.isCooling('a', 0)).toBe(false);
  });
});

describe('pickNearestInside', () => {
  it('returns the nearest spot when two fences overlap', () => {
    const near = makeSpot({ id: 'near', lat: 39.9, lng: 116.4, radiusMeters: 300 });
    const far = makeSpot({ id: 'far', lat: 39.9, lng: 116.41, radiusMeters: 300 });
    // 116.401 is ~85m east of near center, ~665m west of far center
    const picked = pickNearestInside([near, far], 39.9, 116.401);
    expect(picked?.id).toBe('near');
  });

  it('returns null when no fence contains the point', () => {
    const spot = makeSpot({ lat: 39.9, lng: 116.4, radiusMeters: 100 });
    expect(pickNearestInside([spot], 40.0, 116.5)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickNearestInside([], 39.9, 116.4)).toBeNull();
  });
});

describe('GeoWatcher mock mode', () => {
  it('invokes the callback with forced accuracy (≥5) when mock is set', () => {
    const watcher = new GeoWatcher();
    watcher.setMock({ lat: 1, lng: 2, accuracy: 1 });
    let got: Fix | undefined;
    watcher.start((f) => {
      got = f;
    });
    expect(got?.lat).toBe(1);
    expect(got?.accuracy).toBe(5);
  });

  it('invokes the callback again on each setMock while running', () => {
    const watcher = new GeoWatcher();
    let got: Fix | undefined;
    watcher.start((f) => {
      got = f;
    });
    watcher.setMock({ lat: 3, lng: 4, accuracy: 50 });
    expect(got?.lat).toBe(3);
    expect(got?.accuracy).toBe(50);
  });

  it('clears mock with setMock(null) — real GPS path resumes without crash in test env', () => {
    const watcher = new GeoWatcher();
    watcher.start(() => {});
    expect(() => watcher.setMock(null)).not.toThrow();
    watcher.stop();
  });
});
