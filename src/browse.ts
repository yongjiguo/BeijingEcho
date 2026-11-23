import type { AudioPlayer } from './player';
import type { SpotsData, Spot } from './types';
import { getFavorites, isFavorite, toggleFavorite } from './favorites';
import { el } from './ui';
import { popularityScore } from './popularity';

const BASE = import.meta.env.BASE_URL;
const asset = (p: string) => `${BASE}${p}`;
const MUSIC_CREDIT = 'Music: Kevin MacLeod, incompetech, CC-BY 4.0';

export interface ListItem {
  id: string;
  name: string;
  summary: string;
  thumbnail: string | null;
}

export function buildListItems(data: SpotsData): ListItem[] {
  return [...data.spots]
    .sort((a, b) => (popularityScore(b.id) ?? -1) - (popularityScore(a.id) ?? -1))
    .map((s) => ({
    id: s.id,
    name: s.name,
    summary: s.summary,
    thumbnail: s.images?.[0]?.url ?? null,
  }));
}

let overlay: HTMLElement | null = null;
let currentData: SpotsData | null = null;
let currentPlayer: AudioPlayer | null = null;
// last detail page opened from a list — returning to any list scrolls back near it
let lastViewedSpotId: string | null = null;

/** history.state payload marking our entries — browser Back pops them instead of leaving the site. */
interface EchoState {
  echo: 'browse' | 'detail' | 'favorites';
  id?: string;
}

export function isBrowseOpen(): boolean {
  return overlay != null;
}

function closeBrowseInternal(): void {
  currentPlayer?.stop();
  overlay?.remove();
  overlay = null;
  currentData = null;
  currentPlayer = null;
  window.removeEventListener('popstate', onPopState);
}

export function closeBrowse(): void {
  if (!overlay) return;
  history.back(); // popstate → closeBrowseInternal; single teardown path for button AND browser back
}

function onPopState(): void {
  if (!overlay) {
    window.removeEventListener('popstate', onPopState);
    return;
  }
  const st = window.history.state as EchoState | null;
  if (st?.echo === 'browse') {
    showList();
  } else if (st?.echo === 'favorites') {
    showFavorites();
  } else if (st?.echo === 'detail' && st.id) {
    const spot = currentData?.spots.find((s) => s.id === st.id);
    if (spot) renderSpotDetail(overlay, spot, currentPlayer!, backToList);
    else showList();
  } else {
    closeBrowseInternal();
  }
}

function backToList(): void {
  history.back();
}

/** Opens the browse overlay. The auto-tour UI beneath stays intact (listening handle etc.). */
export function openBrowse(data: SpotsData, player: AudioPlayer): void {
  if (overlay) return;
  currentData = data;
  currentPlayer = player;
  overlay = el('div', 'browse-overlay');
  document.body.appendChild(overlay);
  window.addEventListener('popstate', onPopState);
  history.pushState({ echo: 'browse' }, '', '#/browse');
  showList();
}

/** Skips the list: opens the overlay straight onto one spot's detail page
 *  (used by tour-map pins). Back button / ← Back leads to the list as usual. */
export function openSpotDetail(data: SpotsData, spot: Spot, player: AudioPlayer): void {
  if (overlay) return;
  currentData = data;
  currentPlayer = player;
  overlay = el('div', 'browse-overlay');
  document.body.appendChild(overlay);
  window.addEventListener('popstate', onPopState);
  history.pushState({ echo: 'detail', id: spot.id }, '', `#/browse/${spot.id}`);
  renderSpotDetail(overlay, spot, player, backToList);
}

/** Opens the favorites list (landing-screen entry). Reuses the browse overlay
 *  stack: item tap → detail page, browser Back pops layer by layer. */
export function openFavorites(data: SpotsData, player: AudioPlayer): void {
  if (overlay) return;
  currentData = data;
  currentPlayer = player;
  overlay = el('div', 'browse-overlay');
  document.body.appendChild(overlay);
  window.addEventListener('popstate', onPopState);
  history.pushState({ echo: 'favorites' }, '', '#/favorites');
  showFavorites();
}

function openDetailFromOverlay(id: string): void {
  lastViewedSpotId = id;
  const spot = currentData?.spots.find((s) => s.id === id);
  if (spot && overlay) {
    history.pushState({ echo: 'detail', id }, '', `#/browse/${id}`);
    renderSpotDetail(overlay, spot, currentPlayer!, backToList);
  }
}

function scrollToLastViewed(): void {
  if (!lastViewedSpotId) return;
  const row = overlay?.querySelector(`.browse-item[data-spot-id="${CSS.escape(lastViewedSpotId)}"]`);
  row?.scrollIntoView({ block: 'center' });
}

function showList(): void {
  if (!overlay || !currentData) return;
  renderBrowseList(overlay, currentData, openDetailFromOverlay);
  scrollToLastViewed();
}

function showFavorites(): void {
  if (!overlay || !currentData) return;
  const favIds = getFavorites();
  const favSpots = favIds
    .map((id) => currentData!.spots.find((s) => s.id === id))
    .filter((s): s is Spot => s != null);
  renderFavoritesList(overlay, favSpots, openDetailFromOverlay);
  scrollToLastViewed();
}

export function renderBrowseList(
  container: HTMLElement,
  data: SpotsData,
  onOpen: (id: string) => void,
): void {
  container.innerHTML = '';
  const screen = el('main', 'screen browse-screen');
  const header = el('header', 'app-header');
  const closeBtn = el('button', 'btn btn-small', '× Close');
  closeBtn.addEventListener('click', closeBrowse);
  header.append(el('h1', 'app-title-small', `Beijing Spots (${data.spots.length})`), closeBtn);
  screen.append(header);
  screen.append(el('p', 'browse-credits', 'Sorted by editorial popularity score · not live visitor data.'));

  if (data.spots.length === 0) {
    screen.append(el('p', 'muted', 'No spots available yet.'));
    container.append(screen);
    return;
  }

  const list = el('div', 'browse-list');
  for (const item of buildListItems(data)) {
    const row = el('button', 'browse-item');
    row.dataset.spotId = item.id;
    if (item.thumbnail) {
      const img = el('img', 'browse-thumb') as HTMLImageElement;
      img.src = asset(item.thumbnail);
      img.alt = item.name;
      img.loading = 'lazy';
      row.append(img);
    } else {
      row.append(el('div', 'browse-thumb browse-thumb-empty', '京'));
    }
    const text = el('div', 'browse-item-text');
    text.append(el('p', 'browse-item-name', item.name), el('p', 'browse-item-summary', item.summary));
    row.append(text);
    row.addEventListener('click', () => onOpen(item.id));
    list.append(row);
  }
  screen.append(list);
  container.append(screen);
}

/** Favorites list — same row style as browse, filtered to starred spots. */
function renderFavoritesList(
  container: HTMLElement,
  favSpots: Spot[],
  onOpen: (id: string) => void,
): void {
  container.innerHTML = '';
  const screen = el('main', 'screen browse-screen');
  const header = el('header', 'app-header');
  const closeBtn = el('button', 'btn btn-small', '× Close');
  closeBtn.addEventListener('click', closeBrowse);
  header.append(el('h1', 'app-title-small', `Favorites (${favSpots.length})`), closeBtn);
  screen.append(header);

  if (favSpots.length === 0) {
    screen.append(
      el(
        'p',
        'muted',
        'No favorites yet — tap the ★ on a spot\'s page (or next to "Nearest" in the tour) to save it here.',
      ),
    );
    container.append(screen);
    return;
  }

  const list = el('div', 'browse-list');
  for (const spot of favSpots) {
    const row = el('button', 'browse-item');
    row.dataset.spotId = spot.id;
    const thumbUrl = spot.images?.[0]?.url ?? null;
    if (thumbUrl) {
      const img = el('img', 'browse-thumb') as HTMLImageElement;
      img.src = asset(thumbUrl);
      img.alt = spot.name;
      img.loading = 'lazy';
      row.append(img);
    } else {
      row.append(el('div', 'browse-thumb browse-thumb-empty', '京'));
    }
    const text = el('div', 'browse-item-text');
    text.append(el('p', 'browse-item-name', spot.name), el('p', 'browse-item-summary', spot.summary));
    row.append(text);
    row.addEventListener('click', () => onOpen(spot.id));
    list.append(row);
  }
  screen.append(list);
  container.append(screen);
}

export function renderSpotDetail(
  container: HTMLElement,
  spot: Spot,
  player: AudioPlayer,
  onBack: () => void,
): void {
  container.innerHTML = '';
  const screen = el('main', 'screen browse-screen');

  const header = el('header', 'app-header');
  const backBtn = el('button', 'btn btn-small', '← Back');
  backBtn.addEventListener('click', onBack);
  // five-pointed star toggle — solid gold = favorited, hollow = not
  const star = el('button', 'fav-star') as HTMLButtonElement;
  const syncStar = (): void => {
    star.textContent = isFavorite(spot.id) ? '★' : '☆';
    star.classList.toggle('fav-star-on', isFavorite(spot.id));
    star.title = isFavorite(spot.id) ? 'Remove from favorites' : 'Save to favorites';
  };
  syncStar();
  star.addEventListener('click', () => {
    toggleFavorite(spot.id);
    syncStar();
  });
  header.append(backBtn, star);
  screen.append(header);

  // image area: main photo + thumbnail strip when more exist
  if (spot.images.length > 0) {
    const mainImg = el('img', 'browse-photo') as HTMLImageElement;
    mainImg.src = asset(spot.images[0].url);
    mainImg.alt = spot.name;
    screen.append(mainImg);
    if (spot.images.length > 1) {
      const strip = el('div', 'browse-strip');
      for (const image of spot.images) {
        const thumb = el('img', 'browse-strip-thumb') as HTMLImageElement;
        thumb.src = asset(image.url);
        thumb.alt = spot.name;
        thumb.addEventListener('click', () => {
          mainImg.src = asset(image.url);
        });
        strip.append(thumb);
      }
      screen.append(strip);
    }
    const credits = el('p', 'browse-credits', `${spot.images.map((i) => i.credit).join(' · ')} · ${MUSIC_CREDIT}`);
    screen.append(credits);
  } else {
    screen.append(el('p', 'browse-credits', `No photo available · ${MUSIC_CREDIT}`));
  }

  screen.append(el('h2', 'spot-name', spot.name));
  const score = popularityScore(spot.id);
  if (score != null) {
    screen.append(
      el('span', 'popularity-badge', `Popularity · ${score}/100`),
      el('p', 'browse-credits', 'Editorial reference score based on landmark prominence — not live visitor data.'),
    );
  }
  const div = el('div', 'ornament');
  div.append(el('span', 'diamond'), el('span', 'line'), el('span', 'diamond'));
  screen.append(div);

  const playBtn = el('button', 'btn btn-primary', '▶ Play this story');
  // button shape tracks playback: ▶ Play → ⏸ Pause → ▶ Resume → back to ▶ when ended
  let playing = false;
  let paused = false;
  const syncPlayBtn = (): void => {
    playBtn.textContent = !playing ? '▶ Play this story' : paused ? '▶ Resume' : '⏸ Pause';
  };
  playBtn.addEventListener('click', () => {
    if (!playing) {
      player.stop();
      playing = true;
      paused = false;
      syncPlayBtn();
      void player.playSequence([asset(spot.audio)]).finally(() => {
        playing = false;
        paused = false;
        syncPlayBtn();
      });
      return;
    }
    if (paused) {
      player.resume();
      paused = false;
    } else {
      player.pause();
      paused = true;
    }
    syncPlayBtn();
  });
  screen.append(playBtn);

  const transcript = el('details', 'transcript');
  transcript.open = true;
  transcript.append(el('summary', null, 'Show transcript'), el('p', null, spot.transcript));
  screen.append(transcript);

  container.append(screen);
}
