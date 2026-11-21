import type { Spot } from './types';

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

export interface LandingOptions {
  onStart: () => void;
  onBrowse: () => void;
  insecure: boolean;
}

export function renderLanding(root: HTMLElement, opts: LandingOptions): void {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  screen.append(
    el('h1', 'app-title', 'Beijing Echo'),
    el('p', 'tagline', 'Walk near a Beijing landmark and its story plays automatically — in your ears, in English.'),
    el('p', 'muted', 'Location is used only on this device to detect nearby spots. Nothing is stored or sent.'),
  );
  if (opts.insecure) {
    screen.append(
      el('p', 'error', 'This page needs HTTPS (or localhost) to access your location. Please open it over a secure connection.'),
    );
  }
  const start = el('button', 'btn btn-primary', 'Start Audio Tour');
  start.id = 'start-btn';
  start.disabled = opts.insecure;
  start.addEventListener('click', opts.onStart);
  const browse = el('button', 'btn btn-secondary', 'Browse all spots');
  browse.addEventListener('click', opts.onBrowse);
  screen.append(start, browse);
  root.append(screen);
}

export interface RequestingHandle {
  setHint(text: string): void;
}

export function renderRequesting(root: HTMLElement): RequestingHandle {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const hint = el('p', 'muted', 'Requesting location & direction permissions…');
  screen.append(el('h1', 'app-title', 'Beijing Echo'), hint);
  root.append(screen);
  return { setHint: (text: string) => void (hint.textContent = text) };
}

export interface ListeningHandle {
  /** null → default "Listening" copy; otherwise e.g. "Nearest: Temple of Heaven · 400m" */
  setNearest(line: string | null): void;
  /** Transient problem hint (GPS weak / retrying). null clears. */
  setHint(line: string | null): void;
}

export function renderListening(root: HTMLElement, onBrowse: () => void): ListeningHandle {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const header = el('header', 'app-header');
  const browseBtn = el('button', 'btn btn-small', 'Browse');
  browseBtn.addEventListener('click', onBrowse);
  header.append(el('h1', 'app-title-small', 'Beijing Echo'), browseBtn);
  const card = el('section', 'card');
  const headline = el('p', 'status-headline', 'Listening — walk near a spot to hear its story');
  const nearest = el('p', 'status-nearest');
  const hint = el('p', 'status-hint');
  hint.hidden = true;
  card.append(headline, nearest, hint);
  screen.append(header, card);
  root.append(screen);
  return {
    setNearest(line) {
      if (line == null) nearest.textContent = '';
      else nearest.textContent = line;
    },
    setHint(line) {
      hint.textContent = line ?? '';
      hint.hidden = line == null;
    },
  };
}

export interface PlayingOptions {
  spot: Spot;
  badgeText: string;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onBrowse: () => void;
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
  const browseBtn = el('button', 'btn btn-small', 'Browse');
  browseBtn.addEventListener('click', opts.onBrowse);
  header.append(el('h1', 'app-title-small', 'Beijing Echo'), browseBtn);

  const card = el('section', 'card');
  card.append(el('h2', 'spot-name', opts.spot.name));

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
  transcript.append(el('summary', null, 'Show transcript'), el('p', null, opts.spot.transcript));

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
}

export function renderDenied(root: HTMLElement, opts: DeniedOptions): void {
  root.innerHTML = '';
  const screen = el('main', 'screen');
  const card = el('section', 'card');
  card.append(
    el('h2', 'spot-name', 'Location access needed'),
    el(
      'p',
      'muted',
      'Automatic audio tours need your location — it stays on this device and is never stored. To enable it: open Settings → Privacy → Location Services (iOS), or tap the lock icon next to the address bar → Site settings → Location (Android), then retry.',
    ),
  );
  const retry = el('button', 'btn btn-primary', 'Try again');
  retry.addEventListener('click', opts.onRetry);
  card.append(retry);
  screen.append(el('h1', 'app-title-small', 'Beijing Echo'), card);
  root.append(screen);
}
