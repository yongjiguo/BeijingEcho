import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { getFavorites, isFavorite, toggleFavorite } from '../src/favorites';

// node test env has no localStorage — install a minimal in-memory stub first
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

describe('favorites (localStorage-backed)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(getFavorites()).toEqual([]);
    expect(isFavorite('tiananmen-square')).toBe(false);
  });

  it('toggleFavorite adds an id and persists it', () => {
    const added = toggleFavorite('tiananmen-square');
    expect(added).toBe(true);
    expect(isFavorite('tiananmen-square')).toBe(true);
    expect(getFavorites()).toEqual(['tiananmen-square']);
    // persisted in localStorage directly
    expect(JSON.parse(localStorage.getItem('echo-favorites')!)).toEqual(['tiananmen-square']);
  });

  it('toggleFavorite removes an existing id (un-favorite)', () => {
    toggleFavorite('a');
    toggleFavorite('b');
    const added = toggleFavorite('a');
    expect(added).toBe(false);
    expect(getFavorites()).toEqual(['b']);
    expect(isFavorite('a')).toBe(false);
  });

  it('keeps insertion order across multiple ids', () => {
    toggleFavorite('c');
    toggleFavorite('a');
    toggleFavorite('b');
    expect(getFavorites()).toEqual(['c', 'a', 'b']);
  });

  it('survives corrupted storage without throwing', () => {
    localStorage.setItem('echo-favorites', 'not-json{');
    expect(getFavorites()).toEqual([]);
    expect(() => toggleFavorite('x')).not.toThrow();
    expect(getFavorites()).toEqual(['x']);
  });
});
