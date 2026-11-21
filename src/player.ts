/**
 * Audio playback abstraction. `AudioGateway` isolates the browser <audio> element so
 * `AudioPlayer` sequencing logic (skip-on-error, stop/pause routing) is testable in node.
 */
export interface AudioGateway {
  /** Load a url; rejects on load failure. */
  load(url: string): Promise<void>;
  /** Start (or resume) playback; resolves when the track finishes, rejects on abort/error. */
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  onEnded(cb: () => void): void;
  durationSec(): number;
  currentTimeSec(): number;
  seek(sec: number): void;
}

/** <audio>-backed gateway for the browser. */
export class HtmlAudioGateway implements AudioGateway {
  private readonly audio: HTMLAudioElement;
  private endedCb: (() => void) | null = null;

  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.endedCb?.());
  }

  load(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onOk = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error(`load failed: ${url}`));
      };
      const cleanup = () => {
        this.audio.removeEventListener('canplaythrough', onOk);
        this.audio.removeEventListener('error', onErr);
      };
      this.audio.addEventListener('canplaythrough', onOk);
      this.audio.addEventListener('error', onErr);
      this.audio.src = url;
      this.audio.load();
    });
  }

  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('playback error'));
      };
      const cleanup = () => {
        this.audio.removeEventListener('ended', onEnded);
        this.audio.removeEventListener('error', onErr);
      };
      this.audio.addEventListener('ended', onEnded);
      this.audio.addEventListener('error', onErr);
      this.audio.play().catch((e: unknown) => {
        cleanup();
        reject(e instanceof Error ? e : new Error('play() rejected'));
      });
    });
  }

  pause(): void {
    this.audio.pause();
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  durationSec(): number {
    const d = this.audio.duration;
    return Number.isFinite(d) ? d : 0;
  }

  currentTimeSec(): number {
    return this.audio.currentTime;
  }

  seek(sec: number): void {
    this.audio.currentTime = sec;
  }
}

export class AudioPlayer {
  private readonly gateway: AudioGateway;
  private playing = false;
  private stopped = false;
  private trackStartCb: ((index: number, url: string) => void) | null = null;

  constructor(gateway: AudioGateway) {
    this.gateway = gateway;
  }

  onTrackStart(cb: (index: number, url: string) => void): void {
    this.trackStartCb = cb;
  }

  /**
   * Play urls in order; resolves when the last url finishes.
   * Non-last (aux: chime/dir) load error → skip to next; last (main) load error → resolve as ended.
   */
  async playSequence(urls: string[]): Promise<void> {
    this.stopped = false;
    this.playing = true;
    for (let i = 0; i < urls.length; i++) {
      if (this.stopped) break;
      const url = urls[i];
      const isLast = i === urls.length - 1;
      try {
        await this.gateway.load(url);
      } catch {
        if (isLast) break; // main track failed → treat as ended
        continue; // aux track failed → skip
      }
      if (this.stopped) break;
      this.trackStartCb?.(i, url);
      try {
        await this.gateway.play();
      } catch {
        if (this.stopped) break;
        // playback error on a track: treat like ended and move on
      }
    }
    this.playing = false;
  }

  stop(): void {
    this.stopped = true;
    this.playing = false;
    this.gateway.stop();
  }

  pause(): void {
    this.gateway.pause();
  }

  resume(): void {
    this.gateway.play().catch(() => {}); // re-trigger audio.play() for browser resume
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
