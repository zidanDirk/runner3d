/** Narrow backend seam allows real lifecycle tests without pretending a fake is a browser AudioContext. */
export interface AudioClip { readonly duration: number }
export interface AudioVoice { stop(): void; disconnect(): void }
export interface AudioContextBackend {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: AudioContextState;
  createBuffer(samples: Float32Array): AudioClip;
  createVoice(buffer: AudioClip, rate: number, gain: number, ended: () => void): AudioVoice;
  setMasterVolume(volume: number): void;
  subscribeState(listener: () => void): () => void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}
class BrowserClip implements AudioClip {
  constructor(readonly native: AudioBuffer) {}
  get duration(): number { return this.native.duration; }
}

class BrowserAudioBackend implements AudioContextBackend {
  private readonly master: GainNode;
  constructor(private readonly context: AudioContext) {
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);
  }
  get sampleRate(): number { return this.context.sampleRate; }
  get currentTime(): number { return this.context.currentTime; }
  get state(): AudioContextState { return this.context.state; }
  createBuffer(samples: Float32Array): AudioClip {
    const buffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    buffer.getChannelData(0).set(samples);
    return new BrowserClip(buffer);
  }
  createVoice(buffer: AudioClip, rate: number, gain: number, ended: () => void): AudioVoice {
    if (!(buffer instanceof BrowserClip)) throw new Error('Audio buffer belongs to a different backend.');
    const source = this.context.createBufferSource();
    const volume = this.context.createGain();
    source.buffer = buffer.native;
    source.playbackRate.value = rate;
    volume.gain.value = gain;
    let stopped = false;
    let disconnected = false;
    try {
      source.connect(volume); volume.connect(this.master); source.onended = ended;
      source.start();
    } catch (error) {
      source.onended = null;
      source.disconnect(); volume.disconnect();
      throw error;
    }
    return {
      stop: () => { if (!stopped) { stopped = true; source.stop(); } },
      disconnect: () => {
        if (disconnected) return;
        disconnected = true; source.onended = null;
        source.disconnect(); volume.disconnect(); source.buffer = null;
      },
    };
  }
  setMasterVolume(volume: number): void {
    const time = this.context.currentTime;
    this.master.gain.cancelScheduledValues(time);
    this.master.gain.setTargetAtTime(volume * .5, time, .012);
  }
  subscribeState(listener: () => void): () => void {
    this.context.addEventListener('statechange', listener);
    return () => this.context.removeEventListener('statechange', listener);
  }
  resume(): Promise<void> { return this.context.resume(); }
  suspend(): Promise<void> { return this.context.suspend(); }
  close(): Promise<void> { this.master.disconnect(); return this.context.state === 'closed' ? Promise.resolve() : this.context.close(); }
}

/** Called only by AudioManager.unlock in a trusted interaction. Never evaluated during module import. */
export function createBrowserAudioContext(): AudioContextBackend {
  if (typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持 Web Audio。');
  return new BrowserAudioBackend(new AudioContext({ latencyHint: 'interactive' }));
}
