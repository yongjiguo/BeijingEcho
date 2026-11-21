import { describe, expect, it } from 'vitest';
import { OCTANT_ORDER, initialBearing, normalizeAngle, octantFor } from '../src/direction';
import type { DirOctant } from '../src/types';

describe('normalizeAngle', () => {
  it('maps negatives and >360 into [0,360)', () => {
    expect(normalizeAngle(-10)).toBe(350);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-725)).toBe(355);
  });
});

describe('initialBearing', () => {
  const BEIJING = { lat: 39.9042, lng: 116.4074 };

  it('is ~0 due north', () => {
    const b = initialBearing(BEIJING.lat, BEIJING.lng, 39.9142, BEIJING.lng);
    expect(Math.min(b, 360 - b)).toBeLessThan(2);
  });

  it('is ~90 due east', () => {
    const b = initialBearing(BEIJING.lat, BEIJING.lng, BEIJING.lat, BEIJING.lng + 0.01);
    expect(Math.abs(b - 90)).toBeLessThan(2);
  });
});

describe('octantFor', () => {
  // octantFor(bearing, heading): rel = normalize(bearing - heading); 45° windows, lower-inclusive
  it('ahead/next windows at boundaries', () => {
    expect(octantFor(10, 0)).toBe('n'); // rel 10 → ahead
    expect(octantFor(22.5, 0)).toBe('ne'); // rel 22.5 → lower edge of ne is inclusive
    expect(octantFor(22.4, 0)).toBe('n'); // rel 22.4 → still ahead
    expect(octantFor(90, 90)).toBe('n'); // rel 0
    expect(octantFor(90, 91)).toBe('n'); // rel 359 → ahead
    expect(octantFor(350, 350)).toBe('n'); // rel 0
    expect(octantFor(337.5, 0)).toBe('n'); // rel 337.5 → lower edge of n is inclusive
    expect(octantFor(337.4, 0)).toBe('nw'); // rel 337.4 → nw
  });

  it('normalizes negative heading', () => {
    expect(octantFor(0, -22.5)).toBe('ne'); // rel 22.5
  });

  it('maps every relative center to its octant regardless of heading', () => {
    const relCenters: Array<[number, DirOctant]> = [
      [0, 'n'],
      [45, 'ne'],
      [90, 'e'],
      [135, 'se'],
      [180, 's'],
      [225, 'sw'],
      [270, 'w'],
      [315, 'nw'],
    ];
    for (const heading of [0, 137, 289]) {
      for (const [rel, want] of relCenters) {
        expect(octantFor(heading + rel, heading)).toBe(want);
      }
    }
  });

  it('OCTANT_ORDER is the fixed 8-direction sequence', () => {
    expect(OCTANT_ORDER).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
  });
});
