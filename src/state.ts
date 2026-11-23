import type { TourState } from './types';

export type TourEvent =
  | { type: 'START_CLICKED' }
  | { type: 'LOCATION_DENIED' }
  | { type: 'AUTHORIZED' }
  | { type: 'WELCOME_ENDED' }
  | { type: 'FENCE_ENTER'; spotId: string }
  | { type: 'AUDIO_ENDED' }
  | { type: 'RESET' };

/**
 * Allowed transitions per spec §6. Absent mappings mean "illegal event → state unchanged"
 * (this covers welcome+FENCE_ENTER playback-mutex and permission-denied absorbing all).
 * RESET (browser-back exit) returns to landing from any state.
 */
const TRANSITIONS: Record<TourState, Partial<Record<TourEvent['type'], TourState>>> = {
  landing: { START_CLICKED: 'requesting', RESET: 'landing' },
  requesting: { LOCATION_DENIED: 'permission-denied', AUTHORIZED: 'welcome', RESET: 'landing' },
  welcome: { WELCOME_ENDED: 'listening', RESET: 'landing' },
  listening: { FENCE_ENTER: 'playing', RESET: 'landing' },
  playing: { AUDIO_ENDED: 'listening', RESET: 'landing' },
  'permission-denied': { RESET: 'landing' },
};

export class TourStateMachine {
  private state: TourState = 'landing';

  current(): TourState {
    return this.state;
  }

  /** Illegal events return the current state unchanged. */
  transition(evt: TourEvent): TourState {
    const next = TRANSITIONS[this.state][evt.type];
    if (next) this.state = next;
    return this.state;
  }
}
