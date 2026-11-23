import './styles.css';
import { Cooldowns, GeoWatcher, haversineMeters, isAccurate, pickNearestInside } from './geo';
import { CompassWatcher, GpsTrackHeading, HeadingResolver } from './compass';
import { initialBearing, octantFor } from './direction';
import { AudioPlayer, HtmlAudioGateway } from './player';
import { TourStateMachine } from './state';
import { openBrowse, openFavorites, openSpotDetail, isBrowseOpen } from './browse';
import { createTourMap, type TourMapHandle } from './mapview';
import { initTestMode } from './testmode';
import { renderLanding, renderListening, renderDenied, renderPlaying, renderRequesting } from './ui';
import type { DirOctant, SpotsData, Spot } from './types';

const BASE = import.meta.env.BASE_URL;
const asset = (p: string) => `${BASE}${p}`;
const CHIME_URL = asset('audio/chime.mp3');

const OCTANT_PHRASE: Record<DirOctant, string> = {
  n: 'directly ahead of you',
  ne: 'ahead on your right',
  e: 'on your right',
  se: 'behind on your right',
  s: 'right behind you',
  sw: 'behind on your left',
  w: 'on your left',
  nw: 'ahead on your left',
};

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const machine = new TourStateMachine();
const audioEl = new Audio();
const player = new AudioPlayer(new HtmlAudioGateway(audioEl));

// Reveal the direction badge when the voice actually starts (index 0 = chime).
player.onTrackStart((index) => {
  if (index === 1) playing?.revealBadge();
});

const geoWatcher = new GeoWatcher();
const compassWatcher = new CompassWatcher();
const trackHeading = new GpsTrackHeading();
const resolver = new HeadingResolver(compassWatcher, trackHeading);
const cooldowns = new Cooldowns();

let spots: Spot[] = [];
let spotsData: SpotsData | null = null;
const testMode = initTestMode({ geo: geoWatcher, compass: compassWatcher, track: trackHeading });
let listening: ReturnType<typeof renderListening> | null = null;
let playing: ReturnType<typeof renderPlaying> | null = null;
let tourMap: TourMapHandle | null = null;
let playbackGen = 0;
let fixForTrigger: { lat: number; lng: number } | null = null;

// ---- data ----
async function loadSpots(): Promise<void> {
  try {
    const res = await fetch(asset('spots.json'));
    if (!res.ok) throw new Error(`spots.json HTTP ${res.status}`);
    const data: SpotsData = await res.json();
    spotsData = data;
    spots = data.spots ?? [];
    testMode?.setSpots(spots);
  } catch (err) {
    console.warn('spots.json unavailable:', err);
    spots = [];
  }
}

// ---- nearest status line ----
function nearestSpot(lat: number, lng: number): { spot: Spot; dist: number } | null {
  let best: { spot: Spot; dist: number } | null = null;
  for (const s of spots) {
    const d = haversineMeters(s.lat, s.lng, lat, lng);
    if (!best || d < best.dist) best = { spot: s, dist: d };
  }
  return best;
}

function updateNearestStatus(lat: number, lng: number): void {
  if (!listening) return;
  const best = nearestSpot(lat, lng);
  listening.setNearest(
    best ? `Nearest: ${best.spot.name} · ${formatDistance(best.dist)}` : null,
    best?.spot.id ?? null,
  );
}

// ---- playback ----
function beginSpotPlayback(spot: Spot): void {
  const fix = fixForTrigger;
  const mainUrl = asset(`audio/spot-${spot.id}.mp3`);
  let urls: string[];
  let badge: string;
  const heading = resolver.heading();
  if (fix == null || heading == null) {
    urls = [CHIME_URL, mainUrl];
    badge = 'Walk toward the landmark';
    testMode?.log(`trigger ${spot.id}: heading unavailable → skip dir sentence`);
  } else {
    const bearing = initialBearing(fix.lat, fix.lng, spot.landmark.lat, spot.landmark.lng);
    const octant = octantFor(bearing, heading);
    urls = [CHIME_URL, asset(`audio/dir/spot-${spot.id}-${octant}.mp3`), mainUrl];
    badge = `→ ${spot.landmark.name} is ${OCTANT_PHRASE[octant]}`;
    testMode?.log(
      `trigger ${spot.id}: heading ${Math.round(heading)}° · bearing ${Math.round(bearing)}° → octant ${octant}`,
    );
  }

  machine.transition({ type: 'FENCE_ENTER', spotId: spot.id });
  playing = renderPlaying(app, {
    spot,
    badgeText: badge,
    onPause: () => {
      player.pause();
      playing?.setPaused(true);
    },
    onResume: () => {
      player.resume();
      playing?.setPaused(false);
    },
    onReplay: () => {
      playbackGen += 1;
      player.stop();
      void runSequence(urls, playbackGen);
    },
    onMap: () => {
      // Back to the listening screen (map) — narration keeps playing; when it
      // ends, runSequence re-renders listening (a no-op refresh at worst).
      playing = null;
      showListening();
    },
    onBrowse: openBrowseView,
  });
  const gen = ++playbackGen;
  void runSequence(urls, gen);
}

function runSequence(urls: string[], gen: number): Promise<void> {
  audioEl.addEventListener('timeupdate', onTimeUpdate);
  return player.playSequence(urls).then(() => {
    if (gen !== playbackGen) return; // superseded by replay/stop
    audioEl.removeEventListener('timeupdate', onTimeUpdate);
    playing = null;
    showListening();
    machine.transition({ type: 'AUDIO_ENDED' });
  });
}

function onTimeUpdate(): void {
  const d = audioEl.duration;
  if (Number.isFinite(d) && d > 0) playing?.setProgress(audioEl.currentTime / d);
}

const openBrowseView = (): void => {
  if (spotsData) openBrowse(spotsData, player);
};

const openFavoritesView = (): void => {
  if (spotsData) openFavorites(spotsData, player);
};

// ---- states ----
function showLanding(): void {
  renderLanding(app, {
    onStart: startTour,
    onBrowse: openBrowseView,
    onFavorites: openFavoritesView,
    insecure: typeof window !== 'undefined' && window.isSecureContext === false,
  });
}

function showListening(): void {
  listening = renderListening(app, openBrowseView);
  tourMap?.destroy(); // release the previous instance before the DOM is replaced
  tourMap = null;
  if (spotsData && listening.mapEl) {
    tourMap = createTourMap(listening.mapEl, spots, (spot) => {
      if (spotsData) openSpotDetail(spotsData, spot, player);
    }, fixForTrigger, testMode ? (lng, lat) => testMode?.onMapClick(lng, lat) : undefined);
    if (fixForTrigger) tourMap.updateUser(fixForTrigger.lat, fixForTrigger.lng);
  }
  if (fixForTrigger && spots.length > 0) updateNearestStatus(fixForTrigger.lat, fixForTrigger.lng);
}

function startTour(): void {
  // Claim a history entry so the browser Back key exits the tour (to the landing
  // screen) instead of leaving the site — same mechanism as the browse overlay.
  history.pushState({ echo: 'tour' }, '', '#/tour');
  machine.transition({ type: 'START_CLICKED' }); // landing → requesting
  // Unlock the audio element within the same user gesture (iOS Safari requirement).
  void audioEl.play().catch(() => {});
  if (testMode) {
    // Test mode: bypass the real GPS probe and permission prompts entirely.
    renderRequestingScreen();
    onAuthorized();
    return;
  }
  // iOS 13+ orientation permission — same gesture, failure ignored (heading falls back).
  const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<unknown> };
  const orientReq = doe.requestPermission?.bind(DeviceOrientationEvent);
  const orientPerm = orientReq
    ? orientReq().catch(() => 'denied')
    : Promise.resolve('granted');

  renderRequestingScreen();
  void orientPerm.then(() => probeLocation(0));
}

let requesting: ReturnType<typeof renderRequesting> | null = null;
function renderRequestingScreen(): void {
  requesting = renderRequesting(app);
}

function showDenied(): void {
  // The tour entry (#/tour) was pushed when Start was clicked — denial never
  // enters the tour, so clear the stale hash from the address bar.
  history.replaceState({ echo: 'landing' }, '', location.pathname + location.search);
  renderDenied(app, { onRetry: () => window.location.reload(), onBrowse: openBrowseView });
}

function probeLocation(attempt: number): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    machine.transition({ type: 'LOCATION_DENIED' });
    showDenied();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    () => onAuthorized(),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        machine.transition({ type: 'LOCATION_DENIED' });
        showDenied();
        return;
      }
      // timeout / position unavailable → hint + auto-retry (max 3), then manual retry
      if (attempt >= 2) {
        machine.transition({ type: 'LOCATION_DENIED' });
        showDenied();
        return;
      }
      requesting?.setHint(`Location unavailable (${err.message}) — retrying in 10s…`);
      window.setTimeout(() => probeLocation(attempt + 1), 10_000);
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  );
}

function onAuthorized(): void {
  machine.transition({ type: 'AUTHORIZED' });
  requesting = null;

  geoWatcher.onError((msg) => {
    listening?.setHint(`Location problem (${msg}) — retrying in 10s…`);
    window.setTimeout(() => {
      geoWatcher.stop();
      geoWatcher.start(onFix);
    }, 10_000);
  });
  compassWatcher.start((h) => {
    testMode?.log(`heading = ${Math.round(h)}°`);
  });
  geoWatcher.start(onFix);

  // Welcome playback; location listening already running (non-blocking).
  player.playSequence([asset('audio/welcome.mp3')]).then(() => {
    machine.transition({ type: 'WELCOME_ENDED' });
    if (machine.current() === 'listening') showListening();
  });
  showListening();
}

function onFix(fix: { lat: number; lng: number; accuracy: number }): void {
  if (!isAccurate(fix)) {
    listening?.setHint('Waiting for a clearer GPS signal…');
    return;
  }
  listening?.setHint(null);
  fixForTrigger = { lat: fix.lat, lng: fix.lng };
  trackHeading.update(fix);
  updateNearestStatus(fix.lat, fix.lng);
  tourMap?.updateUser(fix.lat, fix.lng);

  const best = nearestSpot(fix.lat, fix.lng);
  testMode?.log(
    `fix (${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}) ±${Math.round(fix.accuracy)}m` +
      (best ? ` → nearest ${best.spot.name} ${Math.round(best.dist)}m` : ''),
  );

  if (machine.current() !== 'listening') return; // welcome/playing: playback mutex
  const inside = pickNearestInside(spots, fix.lat, fix.lng);
  if (!inside) return;
  if (cooldowns.isCooling(inside.id)) {
    testMode?.log(`trigger blocked: ${inside.id} cooling down`);
    return;
  }
  cooldowns.mark(inside.id);
  beginSpotPlayback(inside);
}

// ---- browser back exits the tour ----
function stopTour(): void {
  playbackGen += 1; // invalidate any in-flight audio sequence
  player.stop();
  geoWatcher.stop();
  compassWatcher.stop();
  tourMap?.destroy();
  tourMap = null;
  listening = null;
  playing = null;
  requesting = null;
  fixForTrigger = null;
  machine.transition({ type: 'RESET' });
  showLanding();
}

window.addEventListener('popstate', () => {
  // The browse overlay owns its own history layers (browse.ts handles those pops).
  if (isBrowseOpen()) return;
  const st = window.history.state as { echo?: string } | null;
  if (st?.echo === 'browse' || st?.echo === 'detail') return;
  // Popped the landing entry while a tour is running → user pressed Back in tour.
  if (machine.current() !== 'landing') stopTour();
});

// ---- boot ----
void loadSpots();
showLanding();

// Debug handle for test mode (Task 8) and manual E2E.
declare global {
  interface Window {
    __beijingEcho?: {
      geoWatcher: GeoWatcher;
      compassWatcher: CompassWatcher;
      machine: TourStateMachine;
      player: AudioPlayer;
    };
  }
}
window.__beijingEcho = { geoWatcher, compassWatcher, machine, player };
