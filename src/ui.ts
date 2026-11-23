import type { Spot } from './types';
import { isFavorite, toggleFavorite } from './favorites';
import { createPopularityBadge } from './popularity';

const BASE = import.meta.env.BASE_URL;
const asset = (p: string) => `${BASE}${p}`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Cinnabar seal stamp with the character 京. */
function seal(size: 'lg' | 'sm'): HTMLDivElement {
  return el('div', `seal seal-${size}`, '京');
}

/** Gilt diamond-and-line divider. */
function ornament(): HTMLDivElement {
  const node = el('div', 'ornament');
  node.append(el('span', 'diamond'), el('span', 'line'), el('span', 'diamond'));
  return node;
}

export interface LandingOptions {
  onStart: () => void;
  onBrowse: () => void;
  onFavorites: () => void;
  insecure: boolean;
}

export function renderLanding(root: HTMLElement, opts: LandingOptions): void {
  root.innerHTML = '';
  const screen = el('main', 'screen landing');

  const emblem = el('div', 'landing-emblem rise d1');
  emblem.append(seal('lg'), el('div', 'vertical-title', '北京回声'));

  const title = el('h1', 'app-title rise d2', 'Beijing Echo');
  const div = ornament();
  div.classList.add('rise', 'd3');
  const tagline = el(
    'p',
    'tagline rise d4',
    'Walk near a Beijing landmark and its story plays automatically — in your ears, in English.',
  );
  const privacy = el(
    'p',
    'muted rise d5',
    'Location is used only on this device to detect nearby spots. Nothing is stored or sent.',
  );
  screen.append(emblem, title, div, tagline, privacy);

  if (opts.insecure) {
    screen.append(
      el(
        'p',
        'error',
        'This page needs HTTPS (or localhost) to access your location. Please open it over a secure connection.',
      ),
    );
  }

  const start = el('button', 'btn btn-primary rise d5', 'Start Audio Tour');
  start.id = 'start-btn';
  start.disabled = opts.insecure;
  start.addEventListener('click', opts.onStart);
  const browse = el('button', 'btn btn-secondary rise d6', 'Browse all spots');
  browse.addEventListener('click', opts.onBrowse);
  const favorites = el('button', 'btn btn-secondary rise d6', '★ Favorites');
  favorites.addEventListener('click', opts.onFavorites);
  screen.append(start, browse, favorites);

  screen.append(el('p', 'landing-foot rise d6', '古都 · 回声 · 足下'));
  root.append(screen);
}

export interface RequestingHandle {
  setHint(text: string): void;
}

export function renderRequesting(root: HTMLElement): RequestingHandle {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const head = el('header', 'app-header');
  const brand = el('h1', 'app-title-small');
  brand.append(seal('sm'), document.createTextNode('Beijing Echo'));
  const hint = el('p', 'requesting-note', 'Requesting location & direction permissions…');
  const card = el('div', 'card');
  card.append(hint);
  head.append(brand);
  screen.append(head, card);
  root.append(screen);
  return { setHint: (text: string) => void (card.textContent = text) };
}

export interface ListeningHandle {
  /** null → default "Listening" copy; otherwise e.g. "Nearest: Temple of Heaven · 400m".
   *  spotId (when known) powers the ★ favorite toggle shown next to it. */
  setNearest(line: string | null, spotId?: string | null): void;
  /** Transient problem hint (GPS weak / retrying). null clears. */
  setHint(line: string | null): void;
  /** Container for the Beijing tour map (mounted by main.ts). */
  mapEl: HTMLElement;
}

export function renderListening(root: HTMLElement, onBrowse: () => void): ListeningHandle {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const header = el('header', 'app-header');
  const brand = el('h1', 'app-title-small');
  brand.append(seal('sm'), document.createTextNode('Beijing Echo'));
  const browseBtn = el('button', 'btn btn-small', 'Browse');
  browseBtn.addEventListener('click', onBrowse);
  header.append(brand, browseBtn);

  const card = el('section', 'card rise');
  const headline = el('p', 'status-headline', 'Listening — walk near a spot to hear its story');
  const nearestRow = el('div', 'status-nearest-row');
  const nearest = el('span', 'status-nearest');
  // ★ favorite toggle for the nearest spot — solid gold = saved, hollow = not
  let nearestSpotId: string | null = null;
  const nearStar = el('button', 'fav-star') as HTMLButtonElement;
  nearStar.hidden = true;
  const syncNearStar = (): void => {
    if (!nearestSpotId) {
      nearStar.hidden = true;
      return;
    }
    nearStar.hidden = false;
    nearStar.textContent = isFavorite(nearestSpotId) ? '★' : '☆';
    nearStar.classList.toggle('fav-star-on', isFavorite(nearestSpotId));
    nearStar.title = isFavorite(nearestSpotId) ? 'Remove from favorites' : 'Save to favorites';
  };
  nearStar.addEventListener('click', () => {
    if (!nearestSpotId) return;
    toggleFavorite(nearestSpotId);
    syncNearStar();
  });
  nearestRow.append(nearest, nearStar);
  const hint = el('p', 'status-hint');
  hint.hidden = true;
  const guide = el('ul', 'listening-guide');
  guide.append(
    el('li', null, 'Walk close to a spot — its story plays automatically in English.'),
    el('li', null, 'Tap a red pin on the map to open that spot anytime.'),
    el('li', null, 'Browse (top right) lists every spot — no walking required.'),
  );
  const heatSlot = el('div', 'nearest-popularity');
  card.append(headline, nearestRow, heatSlot, hint, guide);

  const mapEl = el('div', 'tour-map rise');
  screen.append(header, card, mapEl);
  root.append(screen);
  return {
    setNearest(line, spotId) {
      nearest.textContent = line ?? '';
      if (nearestSpotId !== (spotId ?? null)) {
        heatSlot.replaceChildren();
        const heat = spotId ? createPopularityBadge(spotId) : null;
        if (heat) heatSlot.append(heat);
      }
      nearestSpotId = spotId ?? null;
      syncNearStar();
    },
    setHint(line) {
      hint.textContent = line ?? '';
      hint.hidden = line == null;
    },
    mapEl,
  };
}

export interface PlayingOptions {
  spot: Spot;
  badgeText: string;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onBrowse: () => void;
  /** Back to the map (listening screen) — narration keeps playing in the background. */
  onMap: () => void;
}

export interface PlayingHandle {
  /** Called when the narration track (after chime) starts, syncing the badge with the voice. */
  revealBadge(): void;
  setProgress(fraction: number): void;
  setPaused(paused: boolean): void;
}

export function renderPlaying(root: HTMLElement, opts: PlayingOptions): PlayingHandle {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const header = el('header', 'app-header');
  const brand = el('h1', 'app-title-small');
  brand.append(seal('sm'), document.createTextNode('Beijing Echo'));
  const mapBtn = el('button', 'btn btn-small', 'Map');
  mapBtn.addEventListener('click', opts.onMap);
  const browseBtn = el('button', 'btn btn-small', 'Browse');
  browseBtn.addEventListener('click', opts.onBrowse);
  header.append(brand, mapBtn, browseBtn);

  const card = el('section', 'card rise');
  const kicker = el('p', 'spot-kicker', '正在讲述 · NOW NARRATING');
  const name = el('h2', 'spot-name', opts.spot.name);
  const div = ornament();
  card.append(kicker, name);
  const heat = createPopularityBadge(opts.spot.id);
  if (heat) card.append(heat);
  card.append(div);

  // photo area — same treatment as the browse detail page (reuse its styles)
  if (opts.spot.images.length > 0) {
    const mainImg = el('img', 'browse-photo') as HTMLImageElement;
    mainImg.src = asset(opts.spot.images[0].url);
    mainImg.alt = opts.spot.name;
    card.append(mainImg);
    if (opts.spot.images.length > 1) {
      const strip = el('div', 'browse-strip');
      for (const image of opts.spot.images) {
        const thumb = el('img', 'browse-strip-thumb') as HTMLImageElement;
        thumb.src = asset(image.url);
        thumb.alt = opts.spot.name;
        thumb.addEventListener('click', () => {
          mainImg.src = asset(image.url);
        });
        strip.append(thumb);
      }
      card.append(strip);
    }
    card.append(el('p', 'browse-credits', opts.spot.images.map((i) => i.credit).join(' · ')));
  }

  const badge = el('p', 'direction-badge', opts.badgeText);
  badge.hidden = true;
  card.append(badge);

  const progress = el('div', 'progress');
  const fill = el('div', 'progress-fill');
  progress.append(fill);

  const controls = el('div', 'controls');
  const pauseBtn = el('button', 'btn btn-primary', 'Pause');
  pauseBtn.addEventListener('click', () => {
    if (pauseBtn.textContent === 'Pause') opts.onPause();
    else opts.onResume();
  });
  const replayBtn = el('button', 'btn btn-secondary', 'Replay');
  replayBtn.addEventListener('click', opts.onReplay);
  controls.append(pauseBtn, replayBtn);

  const transcript = el('details', 'transcript');
  transcript.open = true; // auto-expanded while narrating — user can still collapse via summary
  transcript.append(el('summary', null, 'Transcript'), el('p', null, opts.spot.transcript));

  card.append(progress, controls, transcript);
  screen.append(header, card);
  root.append(screen);

  return {
    revealBadge() {
      badge.hidden = false;
    },
    setProgress(fraction: number) {
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      fill.style.width = `${pct}%`;
    },
    setPaused(paused: boolean) {
      pauseBtn.textContent = paused ? 'Play' : 'Pause';
    },
  };
}

export interface DeniedOptions {
  onRetry: () => void;
  onBrowse: () => void;
}

export function renderDenied(root: HTMLElement, opts: DeniedOptions): void {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const head = el('header', 'app-header');
  const brand = el('h1', 'app-title-small');
  brand.append(seal('sm'), document.createTextNode('Beijing Echo'));
  head.append(brand);

  const card = el('section', 'card denied-card');
  card.append(
    el('h2', 'spot-name', 'Location access needed'),
    el(
      'p',
      'muted',
      'Automatic audio tours need your location — it stays on this device and is never stored. To enable it: open Settings → Privacy → Location Services (iOS), or tap the lock icon next to the address bar → Site settings → Location (Android), then retry.',
    ),
    el(
      'p',
      'muted',
      'No location? You can still browse every spot — photos, the full story text and its audio — no permission required.',
    ),
  );
  const actions = el('div', 'denied-actions');
  const retry = el('button', 'btn btn-primary', 'Try again');
  retry.addEventListener('click', opts.onRetry);
  const browse = el('button', 'btn btn-secondary', 'Browse all spots');
  browse.addEventListener('click', opts.onBrowse);
  actions.append(retry, browse);
  card.append(actions);
  screen.append(head, card);
  root.append(screen);
}
