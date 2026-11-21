import type { TourState } from './types';

export type TourEvent =
  | { type: 'START_CLICKED' }
  | { type: 'LOCATION_DENIED' }
  | { type: 'AUTHORIZED' }
  | { type: 'WELCOME_ENDED' }
  | { type: 'FENCE_ENTER'; spotId: string }
  | { type: 'AUDIO_ENDED' };

/**
 * Allowed transitions per spec §6. Absent mappings mean "illegal event → state unchanged"
 * (this covers welcome+FENCE_ENTER playback-mutex and permission-denied absorbing all).
 */
const TRANSITIONS: Record<TourState, Partial<Record<TourEvent['type'], TourState>>> = {
  landing: { START_CLICKED: 'requesting' },
  requesting: { LOCATION_DENIED: 'permission-denied', AUTHORIZED: 'welcome' },
  welcome: { WELCOME_ENDED: 'listening' },
  listening: { FENCE_ENTER: 'playing' },
  playing: { AUDIO_ENDED: 'listening' },
  'permission-denied': {},
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
