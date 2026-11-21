import { describe, expect, it, vi } from 'vitest';
import { AudioPlayer, type AudioGateway } from '../src/player';

/** In-memory gateway with scripted failures and ends, modeling browser semantics. */
class FakeGateway implements AudioGateway {
  loadFailFor = new Set<string>();
  autoEndFor = new Set<string>();
  log: string[] = [];
  paused = false;
  private endedCb: (() => void) | null = null;
  private currentUrl = '';
  private pendingPlay: { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null = null;

  load(url: string): Promise<void> {
    this.log.push(`load:${url}`);
    if (this.loadFailFor.has(url)) return Promise.reject(new Error(`load failed: ${url}`));
    this.currentUrl = url;
    return Promise.resolve();
  }

  play(): Promise<void> {
    // resume of an existing paused playback returns the same pending promise
    if (this.paused && this.pendingPlay) {
      this.paused = false;
      this.log.push(`resume:${this.currentUrl}`);
      return this.pendingPlay.promise;
    }
    this.log.push(`play:${this.currentUrl}`);
    if (this.pendingPlay) return this.pendingPlay.promise; // already playing
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pendingPlay = { promise, resolve, reject };
    if (this.autoEndFor.has(this.currentUrl)) {
      queueMicrotask(() => this.end());
    }
    return promise;
  }

  pause(): void {
    this.paused = true;
    this.log.push('pause');
  }

  stop(): void {
    this.paused = false;
    this.log.push('stop');
    const p = this.pendingPlay;
    this.pendingPlay = null;
    p?.reject(new Error('aborted'));
  }

  /** Test helper: finish current track normally. */
  end(): void {
    const p = this.pendingPlay;
    this.pendingPlay = null;
    this.endedCb?.();
    p?.resolve();
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  durationSec(): number {
    return 0;
  }

  currentTimeSec(): number {
    return 0;
  }

  seek(_sec: number): void {
    this.log.push(`seek:${_sec}`);
  }
}

const flush = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(() => r())));

describe('AudioPlayer.playSequence', () => {
  it('plays urls in order and reports track starts', async () => {
    const gw = new FakeGateway();
    gw.autoEndFor.add('dir').add('main');
    const player = new AudioPlayer(gw);
    const starts: Array<[number, string]> = [];
    player.onTrackStart((i, url) => starts.push([i, url]));

    await player.playSequence(['dir', 'main']);

    expect(starts).toEqual([
      [0, 'dir'],
      [1, 'main'],
    ]);
    expect(gw.log).toEqual(['load:dir', 'play:dir', 'load:main', 'play:main']);
    expect(player.isPlaying()).toBe(false);
  });

  it('aux track load error → skip to next, main still plays', async () => {
    const gw = new FakeGateway();
    gw.loadFailFor.add('dir');
    gw.autoEndFor.add('main');
    const player = new AudioPlayer(gw);
    const starts: Array<[number, string]> = [];
    player.onTrackStart((i, url) => starts.push([i, url]));

    await player.playSequence(['dir', 'main']);

    expect(starts).toEqual([[1, 'main']]);
    expect(gw.log).toEqual(['load:dir', 'load:main', 'play:main']);
    expect(player.isPlaying()).toBe(false);
  });

  it('main (last) load error → resolve as ended', async () => {
    const gw = new FakeGateway();
    gw.autoEndFor.add('dir');
    gw.loadFailFor.add('main');
    const player = new AudioPlayer(gw);
    const starts: Array<[number, string]> = [];
    player.onTrackStart((i, url) => starts.push([i, url]));

    await player.playSequence(['dir', 'main']);

    expect(starts).toEqual([[0, 'dir']]);
    expect(gw.log).toEqual(['load:dir', 'play:dir', 'load:main']); // no play:main
    expect(player.isPlaying()).toBe(false);
  });

  it('stop() aborts pending playback and clears the queue', async () => {
    const gw = new FakeGateway(); // 'dir' never auto-ends
    const player = new AudioPlayer(gw);

    const seq = player.playSequence(['dir', 'main']);
    await flush();
    expect(player.isPlaying()).toBe(true);

    player.stop();
    await seq;

    expect(player.isPlaying()).toBe(false);
    expect(gw.log).toEqual(['load:dir', 'play:dir', 'stop']); // never reaches load:main
  });

  it('pause/resume route to the gateway mid-sequence', async () => {
    const gw = new FakeGateway();
    gw.autoEndFor.add('main');
    const player = new AudioPlayer(gw);

    const seq = player.playSequence(['dir', 'main']);
    await flush();

    player.pause();
    expect(gw.paused).toBe(true);

    player.resume();
    expect(gw.paused).toBe(false);

    gw.end(); // finish 'dir' → 'main' auto-ends
    await seq;
    expect(player.isPlaying()).toBe(false);
    expect(gw.log).toEqual(['load:dir', 'play:dir', 'pause', 'resume:dir', 'load:main', 'play:main']);
  });

  it('isPlaying is false before any sequence', () => {
    const player = new AudioPlayer(new FakeGateway());
    expect(player.isPlaying()).toBe(false);
  });

  it('stop() with no active sequence is a safe no-op', () => {
    const player = new AudioPlayer(new FakeGateway());
    expect(() => player.stop()).not.toThrow();
    expect(() => player.pause()).not.toThrow();
    expect(() => player.resume()).not.toThrow();
    expect(player.isPlaying()).toBe(false);
  });
});

describe('HtmlAudioGateway wiring', () => {
  it('is exported and constructable-free in node (class defined)', async () => {
    const mod = await import('../src/player');
    expect(typeof mod.HtmlAudioGateway).toBe('function');
  });
});
