import { describe, expect, it } from 'vitest';
import type { DirOctant, Fix, SpotsData, Spot, TourState } from '../src/types';

describe('types module', () => {
  it('allows constructing a minimal Spot per schema', () => {
    const spot: Spot = {
      id: 'forbidden-city',
      name: 'The Forbidden City (Palace Museum)',
      summary: 'teaser',
      lat: 39.9163,
      lng: 116.3972,
      radiusMeters: 250,
      audio: 'audio/spot-forbidden-city.mp3',
      transcript: 'Full English narration text',
      images: [],
      landmark: { name: 'the Hall of Supreme Harmony', lat: 39.9185, lng: 116.3905 },
    };
    expect(spot.id).toBe('forbidden-city');
    expect(spot.images).toHaveLength(0);
  });

  it('covers the remaining shared types', () => {
    const octant: DirOctant = 'n';
    expect(octant).toBe('n');
    const fix: Fix = { lat: 1, lng: 2, accuracy: 10 };
    expect(fix.accuracy).toBe(10);
    const state: TourState = 'landing';
    expect(state).toBe('landing');
    const data: SpotsData = {
      version: 1,
      welcome: { audio: 'audio/welcome.mp3', transcript: 'welcome text' },
      spots: [],
    };
    expect(data.version).toBe(1);
  });
});
