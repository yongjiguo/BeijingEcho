import { describe, expect, it } from 'vitest';
import { buildListItems } from '../src/browse';
import type { SpotsData, Spot } from '../src/types';

function mkSpot(i: number, images: Spot['images']): Spot {
  return {
    id: `spot-${i}`,
    name: `Spot ${i}`,
    summary: `Summary ${i}`,
    lat: 39.9 + i * 0.001,
    lng: 116.4,
    radiusMeters: 200,
    audio: `audio/spot-${i}.mp3`,
    transcript: `Transcript ${i}`,
    images,
    landmark: { name: `LM ${i}`, lat: 39.9, lng: 116.4 },
  };
}

const data = (spots: Spot[]): SpotsData => ({
  version: 1,
  welcome: { audio: 'audio/welcome.mp3', transcript: 'hi' },
  spots,
});

describe('buildListItems', () => {
  it('maps every spot to id/name/summary/thumbnail', () => {
    const d = data([
      mkSpot(1, [{ url: 'images/a.jpg', credit: 'Photographer A' }]),
      mkSpot(2, []),
    ]);
    expect(buildListItems(d)).toEqual([
      { id: 'spot-1', name: 'Spot 1', summary: 'Summary 1', thumbnail: 'images/a.jpg' },
      { id: 'spot-2', name: 'Spot 2', summary: 'Summary 2', thumbnail: null },
    ]);
  });

  it('handles the full 61-spot dataset', () => {
    const d = data(Array.from({ length: 61 }, (_, i) => mkSpot(i, [])));
    const items = buildListItems(d);
    expect(items).toHaveLength(61);
    expect(items[60].id).toBe('spot-60');
  });

  it('is null-safe when images array is missing', () => {
    const s = mkSpot(3, []);
    (s as unknown as { images?: unknown }).images = undefined;
    const items = buildListItems(data([s]));
    expect(items).toHaveLength(1);
    expect(items[0].thumbnail).toBeNull();
  });
});
