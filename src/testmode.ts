import type { CompassWatcher } from './compass';
import type { GeoWatcher } from './geo';
import { OCTANT_ORDER } from './direction';
import type { DirOctant, Spot } from './types';
import { el } from './ui';

export interface TestModeHooks {
  geo: GeoWatcher;
  compass: CompassWatcher;
}

export interface TestModeHandle {
  /** Append a line to the on-panel status log. */
  log(msg: string): void;
  /** Fill the teleport section once spots data has loaded. */
  setSpots(spots: Spot[]): void;
}

const FACE_DEG: Record<DirOctant, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
};

/** Activates the ?test=1 panel. Returns null when test mode is off (no DOM, no mocking). */
export function initTestMode(hooks: TestModeHooks): TestModeHandle | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('test') !== '1') return null;

  let lines: HTMLElement | null = null;
  let spotRows: HTMLElement | null = null;

  const log = (msg: string): void => {
    if (!lines) return;
    const line = el('div', 'testmode-line', msg);
    lines.append(line);
    while (lines.children.length > 60) lines.firstChild?.remove();
    lines.scrollTop = lines.scrollHeight;
  };

  const teleport = (name: string, lat: number, lng: number): void => {
    hooks.geo.setMock({ lat, lng, accuracy: 5 });
    log(`teleport → ${name} (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
  };

  const buildPanel = (): HTMLElement => {
    const panel = el('div', 'testmode-panel');
    const header = el('div', 'testmode-header');
    header.append(el('span', 'testmode-title', 'TEST MODE'));
    const realBtn = el('button', 'testmode-btn', 'Real sensors');
    realBtn.addEventListener('click', () => {
      hooks.geo.setMock(null);
      hooks.compass.setMock(null);
      log('mocks cleared → real GPS + compass');
    });
    const collapseBtn = el('button', 'testmode-btn', '–');
    let body: HTMLElement | null = null;
    collapseBtn.addEventListener('click', () => {
      if (!body) return;
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      collapseBtn.textContent = hidden ? '–' : '+';
    });
    header.append(realBtn, collapseBtn);
    panel.append(header);

    body = el('div', 'testmode-body');

    // teleport section
    const teleportSection = el('div', 'testmode-section');
    teleportSection.append(el('h4', null, 'Teleport to spot'));
    spotRows = el('div', 'testmode-spots');
    spotRows.append(el('p', 'testmode-empty', 'loading spots…'));
    teleportSection.append(spotRows);
    body.append(teleportSection);

    // manual location section
    const locSection = el('div', 'testmode-section');
    locSection.append(el('h4', null, 'Manual location (WGS-84)'));
    const latInput = el('input', 'testmode-input') as HTMLInputElement;
    latInput.placeholder = 'lat e.g. 39.8822';
    latInput.name = 'testmode-lat';
    const lngInput = el('input', 'testmode-input') as HTMLInputElement;
    lngInput.placeholder = 'lng e.g. 116.4066';
    lngInput.name = 'testmode-lng';
    const goBtn = el('button', 'testmode-btn', 'Go');
    goBtn.addEventListener('click', () => {
      const lat = Number.parseFloat(latInput.value);
      const lng = Number.parseFloat(lngInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        log('manual location: invalid lat/lng');
        return;
      }
      teleport('manual location', lat, lng);
    });
    locSection.append(latInput, lngInput, goBtn);
    body.append(locSection);

    // mock heading section
    const headSection = el('div', 'testmode-section');
    headSection.append(el('h4', null, 'Mock heading'));
    const faceRow = el('div', 'testmode-faces');
    for (const oct of OCTANT_ORDER) {
      const btn = el('button', 'testmode-btn', `Face ${oct.toUpperCase()}`);
      btn.addEventListener('click', () => {
        hooks.compass.setMock(FACE_DEG[oct]);
        log(`heading mock → ${FACE_DEG[oct]}° (${oct})`);
      });
      faceRow.append(btn);
    }
    const angleInput = el('input', 'testmode-input') as HTMLInputElement;
    angleInput.placeholder = 'deg e.g. 88';
    angleInput.name = 'testmode-angle';
    const setBtn = el('button', 'testmode-btn', 'Set');
    setBtn.addEventListener('click', () => {
      const deg = Number.parseFloat(angleInput.value);
      if (!Number.isFinite(deg)) {
        log('heading mock: invalid angle');
        return;
      }
      hooks.compass.setMock(deg);
      log(`heading mock → ${deg}°`);
    });
    headSection.append(faceRow, angleInput, setBtn);
    body.append(headSection);

    // log section
    const logSection = el('div', 'testmode-section');
    logSection.append(el('h4', null, 'Status log'));
    lines = el('div', 'testmode-log');
    logSection.append(lines);
    body.append(logSection);

    panel.append(body);
    return panel;
  };

  document.body.appendChild(buildPanel());
  log('test mode active — real GPS & compass bypassed');

  return {
    log,
    setSpots(spots: Spot[]) {
      if (!spotRows) return;
      spotRows.innerHTML = '';
      if (spots.length === 0) {
        spotRows.append(el('p', 'testmode-empty', 'no spots loaded'));
        return;
      }
      for (const spot of spots) {
        const row = el('div', 'testmode-spot-row');
        const btn = el('button', 'testmode-btn', 'Teleport');
        btn.addEventListener('click', () => teleport(spot.id, spot.lat, spot.lng));
        row.append(el('span', 'testmode-spot-name', spot.name), btn);
        spotRows.append(row);
      }
    },
  };
}
