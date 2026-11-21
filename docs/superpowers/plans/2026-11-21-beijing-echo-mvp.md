# Beijing Echo MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Beijing Echo H5 app (auto-guide + browse modes, 61 spots + 2 airport welcomes, direction-aware narration, test mode) and take it live on Cloudflare Pages free subdomain.

**Architecture:** Pure static site: Vite + vanilla TypeScript SPA reads `content/spots.json` (served via `publicDir`), plays pre-generated MP3s through an AudioGateway-chained player, triggers on geofence entry with compass-based direction openers, and renders a browse list/detail with Wikimedia photos. Python 3.11 scripts build content (Wikipedia fetch → spots.json → images → TTS → validate).

**Tech Stack:** Vite 5, TypeScript (strict), vitest; Python 3.11 (.venv), azure-cognitiveservices-speech / edge-tts, mutagen, requests.

**Spec:** `docs/superpowers/specs/2026-11-21-beijing-audio-guide-design.md`

**Isolation:** in-place (master direct) — user chose; brand-new repo, single-session work, no concurrent branches.

## Global Constraints

- Python 3.11 only (project venv `.venv`); frontend Node ≥ 18, `npm` scripts: `dev`/`build`/`preview`/`test`
- TypeScript `strict: true`; no UI framework; tests via vitest only
- All geo coordinates WGS-84; accuracy filter threshold `100` m; cooldown `30 * 60 * 1000` ms; default spot radius `200` m (per-spot overrides allowed: 50-1000; airports `2000-3000`)
- TTS voice `en-US-AndrewMultilingualNeural`, rate **0.9x** (edge `--rate=-10%`, Azure SSML `rate="-10%"`); keys only via env (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`), never in repo
- Audio decoration (user-final): every playback starts with `audio/chime.mp3` — **~5s wind-chime real recording** (freesound #879798, CC0, first 5s + 1.2s fade-out); auto mode = chime → dir sentence (dry) → narration (main); browse mode = chime → narration
- BGM: 3 tracks (Gymnopedie No 1 / Dreams Become Real / Meditation Impromptu 02, Kevin MacLeod, incompetech, **CC-BY 4.0 → attribution required**) **randomly assigned per narration**; build-time mix at **-8dB** (volume≈0.398, 2s fade-in) via `scripts/mix_audio.py`; shipped narration files are pre-mixed single MP3s
- UI copy all English; content URLs: `/spots.json`, `/audio/...`, `/audio/dir/...`, `/images/...` (vite `publicDir: 'content'`)
- Dir octants fixed order: `n, ne, e, se, s, sw, w, nw`; boundaries at ±22.5° around each of the 8 centers
- Spot ids and narration texts come verbatim from `content/narrations-draft.md` / `content/narrations-draft-2.md` headers (⚠/⚡ review notes stripped from all shipped text)
- Audio dir sentences: 8 per spot from the template table in `narrations-draft.md` (模板节), `{landmark}` replaced by spot `landmark.name`; welcome word has no dir variants

## Review Focus

1. GPS fix with `accuracy` undefined or 0 → must be treated as unreliable and dropped, never crash: pinned by `isAccurate` tests (Task 2).
2. Heading/bearing boundary exactly 22.5° or 337.5° → deterministic octant via `[lower, upper)` windows: pinned by `octantFor` boundary tests (Task 3).
3. Direction MP3 missing/404 → skip dir silently and play main narration, never block: pinned by `AudioPlayer.playSequence` skip test (Task 4).
4. Radius validation split: airport spot at 3000 m passes while a normal spot at 1500 m fails: pinned by `validate_content.py` range tests (Task 13).
5. Welcome word must NOT replay when returning from Browse (only after Start gesture / page refresh): pinned by `TourStateMachine` transition tests (Task 5).

---

### Task 1: Project scaffold (Vite + TS + vitest + content static dir)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts` (stub), `styles.css` (stub), `src/types.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev/build/preview/test`; `src/types.ts` exports used by all later tasks:

```ts
export type DirOctant = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export interface SpotImage { url: string; credit: string; }
export interface Landmark { name: string; lat: number; lng: number; }
export interface Spot { id: string; name: string; summary: string; lat: number; lng: number; radiusMeters: number; audio: string; transcript: string; images: SpotImage[]; landmark: Landmark; }
export interface WelcomeContent { audio: string; transcript: string; }
export interface SpotsData { version: number; welcome: WelcomeContent; spots: Spot[]; }
export interface Fix { lat: number; lng: number; accuracy: number; }
export type TourState = 'landing' | 'requesting' | 'welcome' | 'listening' | 'playing' | 'permission-denied';
```

- `vite.config.ts`: `publicDir: 'content'`, `build.outDir: 'dist'`

- [ ] **Step 1: Write config files** (package.json scripts `dev`/`build`/`preview`/`test` = `vitest run`; tsconfig strict; vite config as above; index.html links `styles.css` and `src/main.ts`)
- [ ] **Step 2: `npm install -D vite typescript vitest`**
- [ ] **Step 3: Write `tests/smoke.test.ts`** asserting `types.ts` compiles exports exist (import type Spot, construct minimal object)
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Run `npm run build`** — Expected: `dist/index.html` created
- [ ] **Step 6: Commit** `feat: scaffold vite+ts project`

### Task 2: geo module — distance, fence, accuracy, cooldown, GPS watcher

**Files:**
- Create: `src/geo.ts`
- Test: `tests/geo.test.ts`

**Interfaces:**
- Consumes: `Spot`, `Fix` from `src/types.ts`
- Produces:

```ts
export const ACCURACY_MAX_METERS = 100;
export const COOLDOWN_MS = 30 * 60 * 1000;
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function isInsideFence(spot: Spot, lat: number, lng: number): boolean;   // distance <= radiusMeters
export function isAccurate(fix: Fix, maxMeters?: number): boolean;              // false when accuracy undefined/0/>max
export class Cooldowns { mark(id: string, now?: number): void; isCooling(id: string, now?: number): boolean; reset(): void; }
export type FixCallback = (fix: Fix) => void;
export class GeoWatcher { start(cb: FixCallback): void; stop(): void; setMock(fix: Fix | null): void; }
// GeoWatcher: navigator.geolocation.watchPosition(enableHighAccuracy); when setMock(fix) is active, real callbacks ignored and cb invoked immediately with fix (accuracy forced >=5)
export function pickNearestInside(spots: Spot[], lat: number, lng: number): Spot | null;  // spec §7 多围栏重叠取最近；无命中返回 null
```

- [ ] **Step 1: Write failing tests** in `tests/geo.test.ts`: haversine Tiananmen(39.9042,116.4074)→TempleOfHeaven(39.8822,116.4066) ≈ 2450m ±30; fence exact-radius→true, radius+1→false; isAccurate: 95→true, 101→false, `NaN`→false, 0→false; Cooldowns: mark→isCooling true, now+31min→false, reset clears; GeoWatcher setMock invokes cb once with forced accuracy; pickNearestInside: two overlapping fences → nearer spot wins, none inside → null
- [ ] **Step 2: Run `npm test`** — Expected: FAIL (module missing)
- [ ] **Step 3: Implement geo.ts** per signatures
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Commit** `feat: geo module`

### Task 3: direction + compass modules

**Files:**
- Create: `src/direction.ts`, `src/compass.ts`
- Test: `tests/direction.test.ts`, `tests/compass.test.ts`

**Interfaces:**
- Consumes: `Fix`, `DirOctant`
- Produces:

```ts
// direction.ts
export function normalizeAngle(deg: number): number;                       // → [0,360)
export function initialBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number;
export const OCTANT_ORDER: DirOctant[];                                    // ['n','ne','e','se','s','sw','w','nw']
export function octantFor(bearingDeg: number, headingDeg: number): DirOctant; // rel=normalize(bearing-heading); [337.5,22.5)→n; [22.5,67.5)→ne; …(45° windows, lower-inclusive)

// compass.ts
export function headingFromDeviceOrientation(evt: DeviceOrientationEvent): number | null;
// webkitCompassHeading if number; else if evt.absolute && alpha!=null → normalize(360 - alpha); else null
export class MedianHeadingFilter { push(deg: number, now?: number): number | null; }  // ~2s sliding window, median; null until ≥3 samples
export class CompassWatcher { start(cb: (h: number) => void): void; stop(): void; setMock(h: number | null): void; }
export class GpsTrackHeading { update(fix: Fix): number | null; }          // needs two fixes ≥5m apart → initialBearing between them
export class HeadingResolver { constructor(compass: CompassWatcher, track: GpsTrackHeading); heading(): number | null; }  // compass-filtered first, then track, else null
```

- [ ] **Step 1: Write failing tests**: normalizeAngle(-10)→350, 370→10; initialBearing Beijing(39.9042,116.4074)→north point(39.9142,116.4074)≈0±2, →east point ≈90±2; octantFor boundaries: (0,10)→n, (0,22.5)→ne, (0,22.4)→n, (90,90)→n, (90,91)→ne? NO — (90,91): rel=359→n; assert table for all 8 octants at center+45° heading; (350,350)→n; negative heading normalize. compass: alpha=20,absolute→heading 340; webkitCompassHeading=123→123; neither→null; MedianHeadingFilter median of [10,20,30]→20; GpsTrackHeading two fixes <5m→null, ≥5m→bearing
- [ ] **Step 2: Run `npm test`** — Expected: FAIL
- [ ] **Step 3: Implement direction.ts + compass.ts** per signatures
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Commit** `feat: direction+compass modules`

### Task 4: audio player with sequential playback and skip-on-error

**Files:**
- Create: `src/player.ts`
- Test: `tests/player.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AudioGateway {
  load(url: string): Promise<void>;   // rejects on load failure
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  onEnded(cb: () => void): void;
  durationSec(): number;
  currentTimeSec(): number;
  seek(sec: number): void;
}
export class HtmlAudioGateway implements AudioGateway { constructor(audio?: HTMLAudioElement); }
export class AudioPlayer {
  constructor(gateway: AudioGateway);
  playSequence(urls: string[]): Promise<void>;  // resolves when last url finishes; dir-track load error → skip to next; main (last) load error → resolve as ended
  stop(): void; pause(): void; resume(): void;
  isPlaying(): boolean;
  onTrackStart(cb: (index: number, url: string) => void): void;
}
```

- [ ] **Step 1: Write failing tests** with an in-memory fake gateway (scripted load errors/ends): sequence plays urls in order (onTrackStart order asserted); dir(0) load error → main(1) still plays and promise resolves; main load error → resolves, isPlaying false; stop() clears pending; pause/resume route to gateway
- [ ] **Step 2: Run `npm test`** — Expected: FAIL
- [ ] **Step 3: Implement player.ts**
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Commit** `feat: audio player`

### Task 5: tour state machine

**Files:**
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `TourState` from types
- Produces:

```ts
export type TourEvent =
  | { type: 'START_CLICKED' } | { type: 'LOCATION_DENIED' } | { type: 'AUTHORIZED' }
  | { type: 'WELCOME_ENDED' } | { type: 'FENCE_ENTER'; spotId: string } | { type: 'AUDIO_ENDED' };
export class TourStateMachine {
  current(): TourState;
  transition(evt: TourEvent): TourState;   // illegal events return current state unchanged
}
```

- Rules (from spec §6): landing+START_CLICKED→requesting; requesting+LOCATION_DENIED→permission-denied; requesting+AUTHORIZED→welcome; welcome+WELCOME_ENDED→listening; **welcome+FENCE_ENTER→welcome (ignored, playback mutex)**; listening+FENCE_ENTER→playing; playing+AUDIO_ENDED→listening; welcome/listening/playing+START_CLICKED→unchanged; permission-denied absorbs everything
- [ ] **Step 1: Write failing table-driven test** covering every row above
- [ ] **Step 2: Run `npm test`** — Expected: FAIL
- [ ] **Step 3: Implement state.ts**
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Commit** `feat: tour state machine`

### Task 6: UI shell — landing / listening / playing / error rendering

**Files:**
- Modify: `index.html`, `styles.css`, `src/main.ts` (replace stub), Create: `src/ui.ts`

**Interfaces:**
- Consumes: TourStateMachine, GeoWatcher, CompassWatcher+HeadingResolver, AudioPlayer, SpotsData
- Produces: `main.ts` wiring: Start button → same-gesture `DeviceOrientationEvent.requestPermission?.()` (ignore failure) + `geolocation.getCurrentPosition` probe → AUTHORIZED/LOCATION_DENIED; welcome playback (player.playSequence([welcome.audio])) → WELCOME_ENDED; GeoWatcher feed → TriggerEngine logic inline in main (nearest-spot status line update; on fence enter & not cooling & not playing → Cooldowns.mark + player.playSequence([dirUrl, mainUrl]) with onTrackStart[0] showing direction badge `→ {landmark.name} is on your {OCTANT}`); playing card shows transcript (collapsible), pause/resume/replay; header Browse button → `browse.open()` (Task 7); error view per spec §9

- [ ] **Step 1: Implement index.html skeleton + styles.css** (mobile-first, single screen, all-English copy per spec §6 elements 1-4)
- [ ] **Step 2: Implement ui.ts render helpers + main.ts wiring** per above; wiring specifics: every accurate fix → `pickNearestInside` updates the status line distance; if inside a fence & state listening & not cooling → `Cooldowns.mark`, resolve heading via HeadingResolver — heading null → `playSequence([chimeUrl, mainUrl])` + badge *"Walk toward the landmark"*, else `playSequence([chimeUrl, dirUrl(octant), mainUrl])` + badge `→ {landmark.name} is on your {OCTANT}` (octant computed at trigger moment only); welcome playback = `playSequence([welcome.audio])` (no chime; the tap already acknowledged the user); geolocation error → status hint, auto-retry in 10s; browse open/close must not stop the watcher
- [ ] **Step 3: `npm run dev`, open with `?test=1` stub absent — verify landing renders; manual check**: Expected: UI matches spec elements; console clean
- [ ] **Step 4: `npm run build`** — Expected: PASS
- [ ] **Step 5: Commit** `feat: ui shell and auto-tour wiring`

### Task 7: browse mode

**Files:**
- Create: `src/browse.ts`
- Test: `tests/browse.test.ts`

**Interfaces:**
- Consumes: `SpotsData`, `Spot`, `AudioPlayer`
- Produces:

```ts
export function buildListItems(data: SpotsData): { id: string; name: string; summary: string; thumbnail: string | null }[];
// thumbnail = spot.images[0]?.url ?? null
export function renderBrowseList(container: HTMLElement, data: SpotsData, onOpen: (id: string) => void): void;
export function renderSpotDetail(container: HTMLElement, spot: Spot, player: AudioPlayer, onBack: () => void): void;
// detail: image area (first image + thumbnail strip if more), full transcript, ▶ Play this story button → player.playSequence([chimeUrl, spot.audio]), credit line under images (image credits + "Music: Kevin MacLeod, incompetech, CC-BY 4.0"), back button
```

- [ ] **Step 1: Write failing test** for `buildListItems` (61 items, thumbnail mapping, null-safe)
- [ ] **Step 2: Run `npm test`** — Expected: FAIL
- [ ] **Step 3: Implement browse.ts** (render functions + open/close preserving auto-tour DOM state)
- [ ] **Step 4: Run `npm test`** — Expected: PASS
- [ ] **Step 5: Manual check**: browse list opens from landing & listening header; detail plays audio; back restores listening card — Expected: state preserved
- [ ] **Step 6: Commit** `feat: browse mode`

### Task 8: test mode panel

**Files:**
- Create: `src/testmode.ts`
- Modify: `src/main.ts` (call init)

**Interfaces:**
- Consumes: `GeoWatcher.setMock`, `CompassWatcher.setMock`, `Spot[]`
- Produces: `export function initTestMode(hooks: { geo: GeoWatcher; compass: CompassWatcher; spots: Spot[]; log: (msg: string) => void }): boolean` — true when `location.search` contains `test=1`; panel: per-spot Teleport button (setMock to spot center, accuracy 5), lat/lng inputs, 8 face buttons + angle input, status log lines (every fix/heading → distance/bearing/octant result)

- [ ] **Step 1: Implement testmode.ts + main.ts hook + log hookup**
- [ ] **Step 2: Manual check**: `npm run dev` + `?test=1` → teleport each of several spots → audio triggers; heading buttons change chosen octant; without param no panel
- [ ] **Step 3: `npm run build`** — Expected: PASS
- [ ] **Step 4: Commit** `feat: test mode panel`

### Task 9: Wikipedia data fetch script

**Files:**
- Create: `scripts/fetch_wikipedia_data.py`, `content/wikipedia-titles.json`
- Test/verify: script run output

**Interfaces:**
- Produces: `content/spot-meta.json`: `{ [id]: { lat, lng, imageUrl: string|null, wikiFile: string|null, landmark: { lat, lng } | null } }`; landmark falls back to null (build script then uses spot center as landmark coords); `content/wikipedia-titles.json` schema: `[ { "id": "forbidden-city", "title": "Forbidden City", "landmarkTitle": "Hall of Supreme Harmony", "radiusMeters": 250 } ]` — 61 rows, ids/landmark names from draft headers, airport rows use `"title": "Beijing Capital International Airport"` / `"Beijing Daxing International Airport"`, radius 3000, landmarkTitle null
- Script behavior: REST `page/summary` per title (1 req/sec, UA header), extract coordinates + originalimage; landmarkTitle summary → landmark coords; failures logged, not fatal

- [ ] **Step 1: Write `content/wikipedia-titles.json`** with all 61 rows (ids from draft headers)
- [ ] **Step 2: Implement `fetch_wikipedia_data.py`** (requests, retry once, 1 rps)
- [ ] **Step 3: Run it** — Expected: spot-meta.json has 61 keys; all coords inside Beijing bounds (lat 39.3-40.4, lng 115.3-117.6); log rows missing images/coords
- [ ] **Step 4: Commit** `feat: wikipedia data fetch`

### Task 10: spots.json build script

**Files:**
- Create: `scripts/build_spots_json.py`
- **Precondition:** user has approved the 61 narrations (审校通过). If not approved, stop and ask.
- Modify: `content/spots.json` (generated)

**Interfaces:**
- Consumes: draft markdown headers `### NN. <id> — <Name> — landmark: "<landmark phrase>"`, body text after header paragraph; `content/spot-meta.json`; `content/wikipedia-titles.json`
- Produces: `content/spots.json` per spec §5 schema: version 1, welcome object (audio/transcript from draft-2 §00), spots[] with lat/lng from meta (missing → FAIL with id list), landmark coords = meta.landmark ?? spot center, images: [] (filled by Task 11), summary = first 12 words of transcript (joined) + '…', radius from wikipedia-titles
- Text cleaning: strip `⚠`/`⚡` review-note runs (pattern ` ⚠ [^—*]*?(?=—|$|(?=[A-Z][a-z]+ ))` — implement as regex removing from `⚠` to next sentence-comma/period/dash; simplest: remove ` ⚠ ...` up to end of that parenthetical/line segment; verify outputs contain no `⚠`/`⚡`)

- [ ] **Step 1: Implement build script** (markdown parse + merge)
- [ ] **Step 2: Run it** — Expected: spots.json valid JSON, 61 spots, no ⚠/⚡ in any transcript, all coords present
- [ ] **Step 3: Commit** `feat: spots.json build script`

### Task 11: image fetch script

**Files:**
- Create: `scripts/fetch_images.py`
- Modify: `content/spots.json` (patches images[])

**Interfaces:**
- Consumes: spots.json image source = spot-meta.json `wikiFile` (filename from originalimage URL basename)
- Produces: `content/images/spot-{id}-1.jpg` (from thumbnail/originalimage, downscale long edge ≤1600px via Pillow), spots.json `images[0] = { url: "images/spot-{id}-1.jpg", credit: "<Artist> / <LicenseShortName>, via Wikimedia Commons" }`; credit via Commons API `action=query&prop=imageinfo&iiprop=extmetadata` (Artist/LicenseShortName, strip HTML tags); missing image → log id, leave images []

- [ ] **Step 1: Implement fetch_images.py** (requests + Pillow, 1 rps)
- [ ] **Step 2: Run it** — Expected: images count logged; spots.json images[] patched; any skips listed
- [ ] **Step 3: Commit** `feat: image fetch with credits`

### Task 12: TTS generation (0.8x) + chime synthesis + BGM mixing

**Files:**
- Create: `scripts/tts_generate.py`, `scripts/mix_audio.py`, `content/audio/bgm/CREDITS.md`
- Modify: `content/audio/**` (generated, gitignored)

**Interfaces:**
- Consumes: spots.json (transcripts, landmark.name); BGM tracks already downloaded at `content/audio/bgm-candidates/` (Gymnopedie No 1 / Dreams Become Real / Meditation Impromptu 02)
- Produces: `content/audio/welcome.mp3`; `content/audio/spot-{id}.mp3` ×61 (**pre-mixed with BGM**); dry dir sentences `content/audio/dir/spot-{id}-{octant}.mp3` ×488; `content/audio/chime.mp3`; `content/audio/bgm/*.mp3` + `CREDITS.md`
- TTS: Azure default (SDK, SSML `rate="-10%"`) → edge-tts fallback (`--rate=-10%`); idempotent (skip existing >10KB); SSML-safe escaping
- Templates (exact):
  - n: `Straight ahead rises {landmark}.`
  - ne: `{landmark} is just ahead on your right.`
  - e: `On your right stands {landmark}.`
  - se: `Just behind you on your right is {landmark}.`
  - s: `{landmark} is right behind you.`
  - sw: `Just behind you on your left is {landmark}.`
  - w: `On your left stands {landmark}.`
  - nw: `{landmark} is just ahead on your left.`
- Mixing (mix_audio.py): per narration file, pick 1 of the 3 BGM tracks **randomly** (seeded `random.Random(2026)` for reproducibility), ffmpeg: `[1:a]volume=0.3981,afade=t=in:st=0:d=2[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0` (loop BGM to voice length when shorter — `aloop`); chime: trim `content/audio/samples/chime-candidates/chime-cand2.mp3` (wind chime, freesound #879798 CC0) to first 5s with `afade=t=out:st=3.8:d=1.2` → `audio/chime.mp3`
- `CREDITS.md`: `Music: "Gymnopedie No 1", "Dreams Become Real", "Meditation Impromptu 02" by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0`

- [ ] **Step 1: Copy BGM tracks** `content/audio/bgm-candidates/*.mp3` → `content/audio/bgm/` and write `CREDITS.md` (text above)
- [ ] **Step 2: Implement tts_generate.py** (rate -20%, provider chain, idempotency, templates)
- [ ] **Step 3: Run tts_generate.py** — Expected: 62 dry mains (61 + welcome) + 488 dir files; spot-check one
- [ ] **Step 4: Implement mix_audio.py** (random-seeded mixing + chime synthesis)
- [ ] **Step 5: Run mix_audio.py** — Expected: 61 mains overwritten with BGM mix (sizes differ from dry), chime.mp3 created; dir files untouched (dry)
- [ ] **Step 6: Spot-check** `spot-temple-of-heaven.mp3` — Expected: 0.8x voice with audible BGM bed, matches approved sample
- [ ] **Step 7: Commit** `feat: tts + chime + bgm mixing`

### Task 13: content validation script

**Files:**
- Create: `scripts/validate_content.py`
- Test/verify: script run

**Interfaces:**
- Consumes: content/spots.json, audio/, images/
- Produces: stdout report + exit 0 (all pass) / 1 (list failures). Checks per spec §8.6: JSON schema fields non-empty; coords in Beijing bounds (lat 39.3-40.4, lng 115.3-117.6); radius: ids `capital-airport-welcome`/`daxing-airport-welcome` within 2000-3000, all others 50-1000; transcript non-empty and no `⚠`/`⚡`; audio files exist, mains 30s-10min via mutagen, dir files 1-15s, all 8 octants per spot present; landmark inside spot fence; images exist + credit non-empty (images [] allowed only with logged skip — enforce credit when images non-empty); `chime.mp3` exists (2-4s), `bgm/` has exactly 3 tracks + non-empty `CREDITS.md`

- [ ] **Step 1: Implement validate_content.py** (`.venv/bin/pip install mutagen` first)
- [ ] **Step 2: Run it** — Expected: exit 0 with summary `61 spots + welcome OK`; fix any failures found in Tasks 9-12 outputs
- [ ] **Step 3: Negative check**: temporarily edit one radius to 1500 → Expected: exit 1 naming the id; revert
- [ ] **Step 4: Commit** `feat: content validation`

### Task 14: end-to-end verification and go-live

**Files:**
- Modify: only fixes discovered here

**Interfaces:**
- Consumes: everything above
- Produces: live `https://<project>.pages.dev`

- [ ] **Step 1: `npm run build`** — Expected: dist contains index.html + assets + spots.json + audio/ + images/ (verify counts)
- [ ] **Step 2: Local full-chain rehearsal**: `npm run preview` + `?test=1` → teleport ≥3 spots incl. one airport; verify dir+main sequence, badge text, transcript, browse play, cooldown (re-teleport same spot within 30min → no replay), refresh resets — Expected: all per spec
- [ ] **Step 3: Real-device GPS check** (optional here, mandatory before promotion): `cloudflared tunnel --url http://localhost:4173` → phone opens HTTPS URL → grant permissions → walk-drive into a fence → Expected: auto playback with correct direction sentence
- [ ] **Step 4: Deploy**: user creates Cloudflare account + GitHub repo (manual, 10 min per spec/plan discussion); push repo; Cloudflare Pages → Connect Git → framework Vite, build `npm run build`, output `dist` → deploy
- [ ] **Step 5: Verify live URL**: open `https://<project>.pages.dev/?test=1` on phone, teleport works; landing without params shows Start flow — Expected: PASS
- [ ] **Step 6: Commit** any fixes `fix: e2e adjustments`; tag `v0.1.0`

---

## Content review gate (standing precondition)

Tasks 10-12 consume narration texts as final only after the user approves the 61 drafts (`content/narrations-draft.md`, `content/narrations-draft-2.md`). Tasks 1-9 and 13-14 may proceed in parallel with review; Task 10 Step 2 must not run until approval.
