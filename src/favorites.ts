/** Favorited spot ids, persisted in localStorage (device-local, no backend). */

const KEY = 'echo-favorites';

export function getFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isFavorite(id: string): boolean {
  return getFavorites().includes(id);
}

/** Adds/removes the id; returns the new favorited state (true = added). */
export function toggleFavorite(id: string): boolean {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  let added: boolean;
  if (idx >= 0) {
    favs.splice(idx, 1);
    added = false;
  } else {
    favs.push(id);
    added = true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(favs));
  } catch {
    // storage full/blocked — state stays in-memory for this call only
  }
  return added;
}
