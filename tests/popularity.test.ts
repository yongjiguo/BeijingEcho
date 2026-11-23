import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { popularityScore } from '../src/popularity';
import { buildListItems } from '../src/browse';
import type { SpotsData } from '../src/types';

const data: SpotsData = JSON.parse(readFileSync(new URL('../content/spots.json', import.meta.url), 'utf8'));

describe('人工参考等级', () => {
  it('所有非机场景点都有有效等级，机场不评级', () => {
    for (const spot of data.spots) {
      const score = popularityScore(spot.id);
      if (spot.id.endsWith('airport-welcome')) expect(score).toBeNull();
      else expect([60, 70, 80, 90, 100]).toContain(score);
    }
    expect(popularityScore('unknown')).toBeNull();
  });

  it('列表降序排序、同分稳定、不改变源数据', () => {
    const original = data.spots.map(s => s.id);
    const items = buildListItems(data);
    const expected = [...data.spots].sort((a, b) =>
      (popularityScore(b.id) ?? -1) - (popularityScore(a.id) ?? -1));
    expect(items.map(s => s.id)).toEqual(expected.map(s => s.id));
    expect(data.spots.map(s => s.id)).toEqual(original);
    expect(popularityScore(items[0].id)).toBe(100);
    expect(popularityScore(items.at(-1)!.id)).toBeNull();
  });
});
