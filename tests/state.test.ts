import { describe, expect, it } from 'vitest';
import { TourStateMachine, type TourEvent } from '../src/state';
import type { TourState } from '../src/types';

/** Drive a fresh machine from 'landing' to the given state via canonical paths. */
function machineIn(from: TourState, seedSpot = 'seed'): TourStateMachine {
  const m = new TourStateMachine();
  switch (from) {
    case 'requesting':
      m.transition({ type: 'START_CLICKED' });
      break;
    case 'welcome':
      m.transition({ type: 'START_CLICKED' });
      m.transition({ type: 'AUTHORIZED' });
      break;
    case 'listening':
      m.transition({ type: 'START_CLICKED' });
      m.transition({ type: 'AUTHORIZED' });
      m.transition({ type: 'WELCOME_ENDED' });
      break;
    case 'playing':
      m.transition({ type: 'START_CLICKED' });
      m.transition({ type: 'AUTHORIZED' });
      m.transition({ type: 'WELCOME_ENDED' });
      m.transition({ type: 'FENCE_ENTER', spotId: seedSpot });
      break;
    case 'permission-denied':
      m.transition({ type: 'START_CLICKED' });
      m.transition({ type: 'LOCATION_DENIED' });
      break;
    case 'landing':
      break;
  }
  expect(m.current()).toBe(from);
  return m;
}

const rows: Array<{ from: TourState; evt: TourEvent; to: TourState }> = [
  // core rules
  { from: 'landing', evt: { type: 'START_CLICKED' }, to: 'requesting' },
  { from: 'requesting', evt: { type: 'LOCATION_DENIED' }, to: 'permission-denied' },
  { from: 'requesting', evt: { type: 'AUTHORIZED' }, to: 'welcome' },
  { from: 'welcome', evt: { type: 'WELCOME_ENDED' }, to: 'listening' },
  { from: 'welcome', evt: { type: 'FENCE_ENTER', spotId: 's1' }, to: 'welcome' }, // playback mutex
  { from: 'listening', evt: { type: 'FENCE_ENTER', spotId: 's1' }, to: 'playing' },
  { from: 'playing', evt: { type: 'AUDIO_ENDED' }, to: 'listening' },
  // START_CLICKED ignored once active
  { from: 'welcome', evt: { type: 'START_CLICKED' }, to: 'welcome' },
  { from: 'listening', evt: { type: 'START_CLICKED' }, to: 'listening' },
  { from: 'playing', evt: { type: 'START_CLICKED' }, to: 'playing' },
  // permission-denied absorbs everything
  { from: 'permission-denied', evt: { type: 'START_CLICKED' }, to: 'permission-denied' },
  { from: 'permission-denied', evt: { type: 'LOCATION_DENIED' }, to: 'permission-denied' },
  { from: 'permission-denied', evt: { type: 'AUTHORIZED' }, to: 'permission-denied' },
  { from: 'permission-denied', evt: { type: 'WELCOME_ENDED' }, to: 'permission-denied' },
  { from: 'permission-denied', evt: { type: 'FENCE_ENTER', spotId: 's1' }, to: 'permission-denied' },
  { from: 'permission-denied', evt: { type: 'AUDIO_ENDED' }, to: 'permission-denied' },
  // every other illegal event leaves the state unchanged
  { from: 'landing', evt: { type: 'FENCE_ENTER', spotId: 's1' }, to: 'landing' },
  { from: 'landing', evt: { type: 'AUTHORIZED' }, to: 'landing' },
  { from: 'landing', evt: { type: 'AUDIO_ENDED' }, to: 'landing' },
  { from: 'requesting', evt: { type: 'FENCE_ENTER', spotId: 's1' }, to: 'requesting' },
  { from: 'requesting', evt: { type: 'AUDIO_ENDED' }, to: 'requesting' },
  { from: 'welcome', evt: { type: 'AUDIO_ENDED' }, to: 'welcome' },
  { from: 'listening', evt: { type: 'WELCOME_ENDED' }, to: 'listening' },
  { from: 'listening', evt: { type: 'AUDIO_ENDED' }, to: 'listening' },
  { from: 'playing', evt: { type: 'FENCE_ENTER', spotId: 's2' }, to: 'playing' },
  { from: 'playing', evt: { type: 'WELCOME_ENDED' }, to: 'playing' },
];

describe('TourStateMachine', () => {
  it('starts at landing', () => {
    expect(new TourStateMachine().current()).toBe('landing');
  });

  it.each(rows.map((r) => [`${r.from} + ${r.evt.type}${'spotId' in r.evt ? `(${r.evt.spotId})` : ''} → ${r.to}`, r] as const))(
    '%s',
    (_label, r) => {
      const m = machineIn(r.from, 'seed');
      const result = m.transition(r.evt);
      expect(result).toBe(r.to);
      expect(m.current()).toBe(r.to);
    },
  );
});
