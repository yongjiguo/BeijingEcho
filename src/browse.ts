import type { AudioPlayer } from './player';
import type { SpotsData, Spot } from './types';
import { el } from './ui';

const BASE = import.meta.env.BASE_URL;
const asset = (p: string) => `${BASE}${p}`;
const CHIME_URL = asset('audio/chime.mp3');
const MUSIC_CREDIT = 'Music: Kevin MacLeod, incompetech, CC-BY 4.0';

export interface ListItem {
  id: string;
  name: string;
  summary: string;
  thumbnail: string | null;
}

export function buildListItems(data: SpotsData): ListItem[] {
  return data.spots.map((s) => ({
    id: s.id,
    name: s.name,
    summary: s.summary,
    thumbnail: s.images?.[0]?.url ?? null,
  }));
}

let overlay: HTMLElement | null = null;
let currentData: SpotsData | null = null;
let currentPlayer: AudioPlayer | null = null;

export function isBrowseOpen(): boolean {
  return overlay != null;
}

export function closeBrowse(): void {
  currentPlayer?.stop();
  overlay?.remove();
  overlay = null;
  currentData = null;
  currentPlayer = null;
}

/** Opens the browse overlay. The auto-tour UI beneath stays intact (listening handle etc.). */
export function openBrowse(data: SpotsData, player: AudioPlayer): void {
  if (overlay) return;
  currentData = data;
  currentPlayer = player;
  overlay = el('div', 'browse-overlay');
  document.body.appendChild(overlay);
  showList();
}

function showList(): void {
  if (!overlay || !currentData) return;
  renderBrowseList(overlay, currentData, (id) => {
    const spot = currentData?.spots.find((s) => s.id === id);
    if (spot && overlay) renderSpotDetail(overlay, spot, currentPlayer!, showList);
  });
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

  if (data.spots.length === 0) {
    screen.append(el('p', 'muted', 'No spots available yet.'));
    container.append(screen);
    return;
  }

  const list = el('div', 'browse-list');
  for (const item of buildListItems(data)) {
    const row = el('button', 'browse-item');
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
  header.append(backBtn);
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
  const div = el('div', 'ornament');
  div.append(el('span', 'diamond'), el('span', 'line'), el('span', 'diamond'));
  screen.append(div);

  const playBtn = el('button', 'btn btn-primary', '▶ Play this story');
  playBtn.addEventListener('click', () => {
    player.stop();
    void player.playSequence([CHIME_URL, asset(spot.audio)]);
  });
  screen.append(playBtn);

  const transcript = el('details', 'transcript');
  transcript.open = true;
  transcript.append(el('summary', null, 'Show transcript'), el('p', null, spot.transcript));
  screen.append(transcript);

  container.append(screen);
}
