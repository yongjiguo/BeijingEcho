import type { CompassWatcher } from './compass';
import type { GpsTrackHeading } from './compass';
import type { GeoWatcher } from './geo';
import { OCTANT_ORDER } from './direction';
import type { DirOctant, Spot } from './types';
import { el } from './ui';

export interface TestModeHooks {
  geo: GeoWatcher;
  compass: CompassWatcher;
  track: GpsTrackHeading;
}

export interface TestModeHandle {
  /** Append a line to the on-panel status log. */
  log(msg: string): void;
  /** Fill the teleport section once spots data has loaded. */
  setSpots(spots: Spot[]): void;
  /** Tour-map click hook (WGS-84) — dispatched by main.ts when the map fires. */
  onMapClick(lng: number, lat: number): void;
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

  // ---- map-click tooling ----
  type ClickMode = 'pick' | 'set' | 'walk';
  let clickMode: ClickMode | null = null;
  let modeButtons: Record<ClickMode, HTMLButtonElement> | null = null;
  let pickedLine: HTMLElement | null = null;
  let walkFromLine: HTMLElement | null = null;
  let walkStatus: HTMLElement | null = null;
  let walkFrom: { lat: number; lng: number } | null = null;
  let walkTimer: number | null = null;
  let lastSet: { lat: number; lng: number } | null = null; // last teleport/manual/map-set position

  const STEP_METERS = 4; // per tick
  const TICK_MS = 250; // → 16 m/s accelerated walk

  const setClickMode = (mode: ClickMode): void => {
    clickMode = clickMode === mode ? null : mode;
    if (!modeButtons) return;
    for (const [name, btn] of Object.entries(modeButtons) as [ClickMode, HTMLButtonElement][]) {
      btn.style.borderColor = name === clickMode ? '#c2453f' : '';
      btn.style.background = name === clickMode ? 'rgba(194, 69, 63, 0.18)' : '';
    }
  };

  const stopWalk = (): boolean => {
    if (walkTimer == null) return false;
    window.clearInterval(walkTimer);
    walkTimer = null;
    return true;
  };

  const startWalk = (headingDeg: number, distanceM: number): void => {
    if (!walkFrom && lastSet) {
      // No map-picked origin — default to the current simulated position.
      walkFrom = lastSet;
      if (walkFromLine) walkFromLine.textContent = `${walkFrom.lat.toFixed(6)}, ${walkFrom.lng.toFixed(6)} (current position)`;
      log('walk sim: origin = current simulated position');
    }
    if (!walkFrom) {
      log('walk sim: pick a start point first (Map click → Walk from)');
      return;
    }
    if (stopWalk()) log('walk sim: previous walk stopped');
    const rad = (headingDeg * Math.PI) / 180;
    const cosLat = Math.cos((walkFrom.lat * Math.PI) / 180);
    let { lat, lng } = walkFrom;
    let travelled = 0;
    hooks.compass.setMock(headingDeg);
    log(`walk sim: start (${lat.toFixed(5)}, ${lng.toFixed(5)}) → ${headingDeg}° for ${distanceM}m`);
    walkTimer = window.setInterval(() => {
      travelled += STEP_METERS;
      lat += (STEP_METERS * Math.cos(rad)) / 111_000;
      lng += (STEP_METERS * Math.sin(rad)) / (111_000 * cosLat);
      hooks.geo.setMock({ lat, lng, accuracy: 5 });
      if (walkStatus) walkStatus.textContent = `${Math.min(travelled, distanceM)}/${distanceM}m @ ${headingDeg}° (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      if (travelled >= distanceM) {
        stopWalk();
        log(`walk sim: finished ${distanceM}m at (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      }
    }, TICK_MS);
  };

  const handleMapClick = (lng: number, lat: number): void => {
    const coordText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    switch (clickMode) {
      case 'pick':
        if (pickedLine) pickedLine.textContent = coordText;
        log(`picked (WGS-84): ${coordText}`);
        break;
      case 'set':
        teleport('map click', lat, lng);
        break;
      case 'walk':
        walkFrom = { lat, lng };
        if (walkFromLine) walkFromLine.textContent = coordText;
        log(`walk start set: ${coordText}`);
        break;
      default:
        break; // no mode armed → plain map interaction, no debug action
    }
  };

  const log = (msg: string): void => {
    if (!lines) return;
    const line = el('div', 'testmode-line', msg);
    lines.append(line);
    while (lines.children.length > 60) lines.firstChild?.remove();
    lines.scrollTop = lines.scrollHeight;
  };

  const teleport = (name: string, lat: number, lng: number): void => {
    hooks.geo.setMock({ lat, lng, accuracy: 5 });
    lastSet = { lat, lng };
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
      hooks.track.setMock(null);
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

    // mock walking direction (GPS track heading) section
    const trackSection = el('div', 'testmode-section');
    trackSection.append(el('h4', null, 'Walk direction (GPS track)'));
    const trackRow = el('div', 'testmode-faces');
    for (const oct of OCTANT_ORDER) {
      const btn = el('button', 'testmode-btn', `Walk ${oct.toUpperCase()}`);
      btn.addEventListener('click', () => {
        hooks.compass.setMock(null); // track applies only when compass is unset (fallback chain)
        hooks.track.setMock(FACE_DEG[oct]);
        log(`track heading mock → ${FACE_DEG[oct]}° (${oct}); compass mock cleared`);
      });
      trackRow.append(btn);
    }
    trackSection.append(trackRow);
    body.append(trackSection);

    // map click modes (tour map only — coordinates are WGS-84 after inverse GCJ-02)
    const clickSection = el('div', 'testmode-section');
    clickSection.append(el('h4', null, 'Map click (tour map)'));
    const modeRow = el('div', 'testmode-faces');
    modeButtons = {
      pick: el('button', 'testmode-btn', 'Pick coord'),
      set: el('button', 'testmode-btn', 'Set position'),
      walk: el('button', 'testmode-btn', 'Walk from'),
    };
    for (const [name, btn] of Object.entries(modeButtons) as [ClickMode, HTMLButtonElement][]) {
      btn.addEventListener('click', () => {
        setClickMode(name);
        log(`map click mode → ${name === clickMode ? name : 'off'}`);
      });
      modeRow.append(btn);
    }
    pickedLine = el('p', 'testmode-line', 'picked: —');
    clickSection.append(modeRow, pickedLine);
    body.append(clickSection);

    // walk simulator: from point (map) + heading + distance → animated GPS walk
    const walkSection = el('div', 'testmode-section');
    walkSection.append(el('h4', null, 'Walk sim'));
    walkFromLine = el('p', 'testmode-line', 'from: — (arm "Walk from", then click the map)');
    const walkHeading = el('input', 'testmode-input') as HTMLInputElement;
    walkHeading.placeholder = 'heading deg e.g. 88';
    walkHeading.name = 'testmode-walk-heading';
    const walkDist = el('input', 'testmode-input') as HTMLInputElement;
    walkDist.placeholder = 'distance m e.g. 300';
    walkDist.name = 'testmode-walk-dist';
    const walkStartBtn = el('button', 'testmode-btn', 'Start walk');
    walkStartBtn.addEventListener('click', () => {
      const heading = Number.parseFloat(walkHeading.value);
      const dist = Number.parseFloat(walkDist.value);
      if (!Number.isFinite(heading) || !Number.isFinite(dist) || dist <= 0) {
        log('walk sim: invalid heading/distance');
        return;
      }
      startWalk(heading, dist);
    });
    const walkStopBtn = el('button', 'testmode-btn', 'Stop');
    walkStopBtn.addEventListener('click', () => {
      if (stopWalk()) log('walk sim: stopped');
    });
    walkStatus = el('p', 'testmode-line', 'status: idle');
    walkSection.append(walkFromLine, walkHeading, walkDist, walkStartBtn, walkStopBtn, walkStatus);
    body.append(walkSection);

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
    onMapClick: handleMapClick,
  };
}
