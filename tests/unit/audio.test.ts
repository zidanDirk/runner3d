import { describe, expect, it } from 'vitest';
import { AUDIO_STORAGE_KEY, AudioManager } from '../../src/audio/AudioManager';
import type { AudioStorage } from '../../src/audio/AudioManager';
import type { AudioClip, AudioContextBackend, AudioVoice } from '../../src/audio/backend';
import { AUDIO_PROVENANCE, SOUND_IDS, synthesizeSound } from '../../src/audio/synthesis';
import type { SoundId } from '../../src/audio/synthesis';
import type { EffectPalette, FeedbackEvent } from '../../src/feedback/types';

const palette: EffectPalette = { coin: [1, .8, .2], dust: [.4, .5, .6], impact: [1, .3, .2], trail: [.2, .4, 1], neon: 0 };
function event(type: SoundId = 'coin', tick = 1, runId = 1, suffix = ''): FeedbackEvent {
  const context = { id: `${runId}:${tick}:${type}:${suffix}`, runId, tick, time: tick / 120, distance: tick / 120 * 16, position: [0, 0, 0] as const, intensity: .8 };
  switch (type) {
    case 'coin': return { ...context, type, entityId: `coin-${tick}-${suffix}`, total: tick };
    case 'jump': case 'land': case 'game-over': return { ...context, type };
    case 'slide': return { ...context, type, duration: .75 };
    case 'lane': return { ...context, type, direction: -1, duration: .2 };
    case 'collision': return { ...context, type, obstacle: 'hurdle' };
    case 'speed': return { ...context, type, speed: 20 };
  }
}
class FakeClip implements AudioClip { constructor(readonly duration: number) {} }
class FakeVoice implements AudioVoice {
  stopCount = 0;
  disconnectCount = 0;
  constructor(readonly rate: number, readonly gain: number, private readonly ended: () => void) {}
  stop(): void { this.stopCount++; this.ended(); }
  disconnect(): void { this.disconnectCount++; }
  end(): void { this.ended(); }
}
class FakeContext implements AudioContextBackend {
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly voices: FakeVoice[] = [];
  readonly listeners = new Set<() => void>();
  readonly volumes: number[] = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  bufferCount = 0;
  failBuffer = false;
  failVoice = false;
  resumeHook: (() => Promise<void>) | null = null;
  suspendHook: (() => Promise<void>) | null = null;
  createBuffer(samples: Float32Array): AudioClip {
    if (this.failBuffer) { this.failBuffer = false; throw new Error('allocation rejected'); }
    this.bufferCount++; return new FakeClip(samples.length / this.sampleRate);
  }
  createVoice(_buffer: AudioClip, rate: number, gain: number, ended: () => void): AudioVoice {
    if (this.failVoice) throw new Error('source unavailable');
    const voice = new FakeVoice(rate, gain, ended); this.voices.push(voice); return voice;
  }
  setMasterVolume(volume: number): void { this.volumes.push(volume); }
  subscribeState(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  setState(value: AudioContextState): void { this.state = value; for (const listener of this.listeners) listener(); }
  resume(): Promise<void> {
    this.resumeCount++;
    if (this.resumeHook) return this.resumeHook();
    this.setState('running'); return Promise.resolve();
  }
  suspend(): Promise<void> { this.suspendCount++; if (this.suspendHook) return this.suspendHook(); this.setState('suspended'); return Promise.resolve(); }
  close(): Promise<void> { this.closeCount++; this.setState('closed'); return Promise.resolve(); }
  endAll(): void { for (const voice of this.voices) voice.end(); }
}
class MemoryStorage implements AudioStorage {
  value: string | null = null;
  keys: string[] = [];
  throws = false;
  getItem(key: string): string | null { if (this.throws) throw new Error('blocked storage'); this.keys.push(key); return this.value; }
  setItem(key: string, value: string): void { if (this.throws) throw new Error('blocked storage'); this.keys.push(key); this.value = value; }
}
function fixture() {
  const context = new FakeContext(); let factories = 0;
  const manager = new AudioManager({ contextFactory: () => { factories++; return context; }, storage: null });
  return { context, manager, factoryCount: () => factories };
}
function deferred() {
  let resolve = (): void => {};
  let reject = (_reason: Error): void => {};
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('original procedural audio PCM', () => {
  it('synthesizes all 8 short, deterministic, finite cues with softened edges and headroom', () => {
    for (const id of SOUND_IDS) for (const neon of [0, 1]) {
      const cue = synthesizeSound(id, 48000, neon); const again = synthesizeSound(id, 48000, neon);
      expect(cue.samples.every((sample, i) => sample === again.samples[i])).toBe(true);
      expect(cue.samples.every(Number.isFinite)).toBe(true);
      expect(cue.duration).toBeGreaterThan(.1); expect(cue.duration).toBeLessThanOrEqual(.46);
      expect(Math.abs(cue.samples[0] ?? 1)).toBe(0); expect(Math.abs(cue.samples.at(-1) ?? 1)).toBe(0);
      expect(cue.peak).toBeGreaterThan(.12); expect(cue.peak).toBeLessThanOrEqual(.240001);
      expect(cue.rms).toBeGreaterThan(.015); expect(cue.rms).toBeLessThan(.11);
      expect(cue.provenance).toBe(AUDIO_PROVENANCE);
      const first = cue.samples.slice(0, 48); expect(Math.max(...first.map(Math.abs))).toBeLessThan(.025);
    }
    const warm = synthesizeSound('coin', 48000, 0); const neon = synthesizeSound('coin', 48000, 1);
    expect(warm.samples.some((sample, i) => sample !== neon.samples[i])).toBe(true);
  });
  it('rejects unsafe allocation inputs, supports common device rates, and clamps palette only', () => {
    for (const rate of [NaN, 0, -10, 48000.5, 192001, Infinity]) expect(() => synthesizeSound('coin', rate)).toThrow(/sample rate/);
    expect(() => synthesizeSound('coin', 48000, NaN)).toThrow(/palette/);
    for (const rate of [8000, 44100, 96000, 192000]) expect(synthesizeSound('land', rate).samples.length).toBe(Math.ceil(rate * .17));
    expect(synthesizeSound('coin', 8000, -1).samples).toEqual(synthesizeSound('coin', 8000, 0).samples);
  });
});

describe('AudioManager real lifecycle boundaries through an injected backend', () => {
  it('creates no context until unlock, caches PCM once, and never resumes while handling events', async () => {
    const { manager, context, factoryCount } = fixture(); const initial = manager.getSnapshot();
    expect(manager.getSnapshot()).toBe(initial); expect(initial.status).toBe('locked');
    manager.handle(event(), palette); manager.setVolume(.4); manager.setMuted(true); manager.setMuted(false); manager.setPaused(true); manager.reset();
    expect(factoryCount()).toBe(0);
    await manager.unlock(); expect(factoryCount()).toBe(1); expect(context.resumeCount).toBe(1); expect(context.bufferCount).toBe(16);
    expect(manager.getSnapshot()).toEqual({ muted: false, volume: .4, enabled: true, status: 'ready' });
    manager.handle(event('jump', 2), palette); expect(context.voices).toHaveLength(1);
    await manager.unlock(); expect(factoryCount()).toBe(1); expect(context.bufferCount).toBe(16); expect(context.resumeCount).toBe(1);
    expect(manager.diagnostics().started).toBe(1); await manager.dispose();
  });
  it('crossfades warm/neon buffers smoothly and caps actual source nodes at 12', async () => {
    const { manager, context } = fixture(); await manager.unlock();
    for (let i = 1; i <= 50; i++) manager.handle(event('coin', i), { ...palette, neon: .25 });
    expect(manager.diagnostics().activeVoices).toBe(12); expect(manager.diagnostics().peakVoices).toBe(12); expect(manager.diagnostics().dropped).toBe(44);
    const a = context.voices[0]; const b = context.voices[1];
    expect(a?.gain).toBeCloseTo((b?.gain ?? 0) * 3);
    manager.handle(event('collision', 51), { ...palette, neon: .5 });
    expect(manager.diagnostics().activeVoices).toBe(12); expect(manager.diagnostics().stopped).toBe(2);
    context.endAll(); context.endAll();
    expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.diagnostics().started).toBe(manager.diagnostics().ended + manager.diagnostics().stopped);
    expect(context.voices.every((voice) => voice.disconnectCount === 1)).toBe(true); await manager.dispose();
  });
  it('deduplicates same tick and rejects arbitrarily old replays with bounded memory', async () => {
    const { manager, context } = fixture(); await manager.unlock();
    const first = event('coin', 1); manager.handle(first, palette); manager.handle(first, palette);
    for (let tick = 2; tick <= 10000; tick++) { context.voices.at(-1)?.end(); manager.handle(event('coin', tick), palette); }
    const before = manager.diagnostics().started; manager.handle(first, palette);
    expect(manager.diagnostics().started).toBe(before); expect(manager.diagnostics().duplicates).toBe(2); expect(manager.diagnostics().dedupSize).toBe(1);
    context.endAll();
    for (let i = 0; i < 500; i++) manager.handle(event('coin', 10001, 1, String(i)), palette);
    expect(manager.diagnostics().dedupSize).toBe(256); expect(manager.diagnostics().activeVoices).toBeLessThanOrEqual(12);
    manager.handle(event('coin', 10001, 1, '0'), palette); expect(manager.diagnostics().duplicates).toBe(3);
    await manager.dispose();
  });
  it('bounds consecutive coin pitch, resets after a gap and on a new run', async () => {
    const { manager, context } = fixture(); await manager.unlock();
    for (let tick = 1; tick <= 20; tick++) { manager.handle(event('coin', tick), palette); context.endAll(); }
    expect(manager.diagnostics().lastCoinPlaybackRate).toBeCloseTo(2 ** (1.2 / 12));
    manager.handle(event('coin', 100), palette); expect(manager.diagnostics().lastCoinPlaybackRate).toBe(1);
    manager.handle(event('coin', 1, 2), palette); expect(manager.diagnostics().lastCoinPlaybackRate).toBe(1);
    manager.handle(event('coin', 1, 1), palette); expect(manager.diagnostics().activeVoices).toBe(1); expect(manager.diagnostics().duplicates).toBe(1);
    expect(manager.diagnostics().activeVoices).toBe(1); expect(context.resumeCount).toBe(1); await manager.dispose();
  });
  it('suspends once on pause, drops paused events, and requires gesture unlock after unpause', async () => {
    const { manager, context } = fixture(); await manager.unlock(); manager.handle(event('slide'), palette);
    manager.setPaused(true); for (let i = 0; i < 100; i++) manager.setPaused(true);
    expect(context.suspendCount).toBe(1); expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.getSnapshot().status).toBe('suspended');
    manager.handle(event('jump', 2), palette); manager.setPaused(false); manager.handle(event('land', 3), palette);
    expect(context.resumeCount).toBe(1); expect(manager.diagnostics().started).toBe(1);
    await manager.unlock(); manager.handle(event('coin', 4), palette); expect(context.resumeCount).toBe(2); expect(manager.diagnostics().started).toBe(2);
    expect(manager.diagnostics().dropped).toBe(2); await manager.dispose();
  });
  it('lets a pause after a pending unlock win without stale notes or additional contexts', async () => {
    const { manager, context, factoryCount } = fixture(); const pending = deferred(); context.resumeHook = () => pending.promise;
    const a = manager.unlock(); const b = manager.unlock(); expect(a).toBe(b); manager.setPaused(true);
    manager.handle(event('coin'), palette); context.setState('running'); pending.resolve(); await a;
    expect(context.state).toBe('suspended'); expect(manager.getSnapshot().enabled).toBe(false); expect(manager.diagnostics().activeVoices).toBe(0);
    expect(context.resumeCount).toBe(1); expect(factoryCount()).toBe(1); await manager.dispose();
  });
  it('queues a fresh gesture resume behind a suspend still waiting for the audio render thread', async () => {
    const { manager, context } = fixture(); await manager.unlock(); const renderThread = deferred();
    context.suspendHook = () => renderThread.promise.then(() => context.setState('suspended'));
    context.resumeHook = () => renderThread.promise.then(() => context.setState('running'));
    manager.setPaused(true); expect(context.state).toBe('running');
    const unlocking = manager.unlock(); expect(context.resumeCount).toBe(2);
    renderThread.resolve(); await unlocking;
    expect(context.state).toBe('running'); expect(manager.getSnapshot().enabled).toBe(true); expect(manager.diagnostics().contextCount).toBe(1);
    await manager.dispose();
  });
  it('handles rejected resume visibly and retries the same context without replaying old events', async () => {
    const { manager, context } = fixture(); context.resumeHook = () => Promise.reject(new Error('gesture rejected'));
    await manager.unlock(); expect(manager.getSnapshot().status).toBe('blocked'); expect(manager.diagnostics().errors).toBe(1);
    const rejected = event(); manager.handle(rejected, palette); context.resumeHook = null;
    await manager.unlock(); manager.handle(rejected, palette); expect(manager.diagnostics().activeVoices).toBe(0);
    manager.handle(event('coin', 2), palette); expect(manager.diagnostics().activeVoices).toBe(1); expect(manager.diagnostics().contextCount).toBe(1); await manager.dispose();
  });
  it('disposes safely during unlock, closes once, and stays terminal on subsequent interactions', async () => {
    const { manager, context } = fixture(); const pending = deferred(); context.resumeHook = () => pending.promise;
    const unlocking = manager.unlock(); const closeA = manager.dispose(); const closeB = manager.dispose(); expect(closeA).toBe(closeB);
    pending.resolve(); await unlocking; await closeA; await manager.unlock(); manager.handle(event(), palette); manager.setVolume(.9); manager.setMuted(true);
    expect(context.closeCount).toBe(1); expect(context.listeners.size).toBe(0); expect(manager.getSnapshot().status).toBe('disposed');
    expect(manager.diagnostics().bufferCount).toBe(0); expect(manager.diagnostics().activeVoices).toBe(0); expect(context.resumeCount).toBe(1);
  });
  it('cleans voices/listeners on repeated restart and a full mount/dispose lifecycle', async () => {
    const { manager, context } = fixture(); let notifications = 0; const stop = manager.subscribe(() => notifications++);
    await manager.unlock();
    for (let run = 1; run <= 100; run++) {
      for (const [index, cue] of SOUND_IDS.entries()) manager.handle(event(cue, index, run), { ...palette, neon: run % 2 });
      manager.reset(); expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.diagnostics().dedupSize).toBe(0);
    }
    expect(manager.diagnostics().contextCount).toBe(1); expect(manager.diagnostics().bufferCount).toBe(16);
    expect(manager.diagnostics().started).toBe(manager.diagnostics().stopped); expect(context.voices.every((voice) => voice.disconnectCount === 1)).toBe(true);
    stop(); const previous = notifications; manager.setVolume(.3); expect(notifications).toBe(previous);
    await manager.dispose(); expect(context.listeners.size).toBe(0); expect(manager.diagnostics().listenerCount).toBe(0);
    const next = fixture(); await next.manager.unlock(); expect(next.manager.diagnostics().contextCount).toBe(1); await next.manager.dispose();
  });
  it('persists volume/mute safely, validates stored values, and leaves context creation lazy', async () => {
    const storage = new MemoryStorage(); storage.value = JSON.stringify({ muted: true, volume: .2 }); const context = new FakeContext();
    const manager = new AudioManager({ storage, contextFactory: () => context }); let notified = 0; const detach = manager.subscribe(() => notified++);
    expect(manager.getSnapshot().muted).toBe(true); expect(manager.getSnapshot().volume).toBe(.2);
    manager.setVolume(2); expect(manager.getSnapshot().volume).toBe(1); manager.setVolume(-1); expect(manager.getSnapshot().volume).toBe(0);
    const unchanged = manager.getSnapshot(); manager.setVolume(NaN); manager.setVolume(Infinity); expect(manager.getSnapshot()).toBe(unchanged);
    manager.setVolume(.4); manager.setMuted(false); await manager.unlock(); manager.handle(event(), palette); manager.setMuted(true);
    expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.getSnapshot().enabled).toBe(false); expect(context.volumes.at(-1)).toBe(0);
    const saved: unknown = JSON.parse(storage.value ?? '{}'); expect(saved).toEqual({ muted: true, volume: .4 }); expect(storage.keys.every((key) => key === AUDIO_STORAGE_KEY)).toBe(true);
    manager.reset(); expect(manager.getSnapshot().muted).toBe(true); expect(manager.getSnapshot().volume).toBe(.4);
    detach(); expect(notified).toBeGreaterThan(2); await manager.dispose();
    for (const value of ['{bad', '{}', '{"muted":true,"volume":null}', '{"muted":false,"volume":5}']) {
      storage.value = value; const invalid = new AudioManager({ storage }); expect(invalid.getSnapshot().volume).toBe(.55); await invalid.dispose();
    }
    storage.throws = true; const blocked = new AudioManager({ storage }); blocked.setMuted(true); blocked.setVolume(.1); expect(blocked.getSnapshot().volume).toBe(.1); expect(blocked.diagnostics().storageFailures).toBe(3); await blocked.dispose();
  });
  it('reports unavailable Web Audio and handles allocation/playback failures without leaking or throwing', async () => {
    const unsupported = new AudioManager({ contextFactory: () => { throw new Error('unsupported'); }, storage: null });
    await unsupported.unlock(); expect(unsupported.getSnapshot().status).toBe('unsupported'); expect(unsupported.diagnostics().contextCount).toBe(0); await unsupported.dispose();
    const { manager, context } = fixture(); context.failBuffer = true; await manager.unlock(); expect(manager.getSnapshot().status).toBe('blocked');
    await manager.unlock(); expect(manager.diagnostics().contextCount).toBe(1); expect(manager.diagnostics().bufferCount).toBe(16);
    context.failVoice = true; manager.handle(event(), palette); expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.diagnostics().errors).toBe(2);
    context.failVoice = false; manager.handle(event('jump', 2), palette); expect(manager.diagnostics().activeVoices).toBe(1);
    context.setState('suspended'); expect(manager.diagnostics().activeVoices).toBe(0); expect(manager.getSnapshot().status).toBe('suspended'); await manager.dispose();
  });
});

it('new power-up and growth facts reuse one PCM bank with distinct rates and bounded sources', async () => {
  const context = new FakeContext(); const manager = new AudioManager({ contextFactory: () => context, storage: null }); await manager.unlock();
  const base = { id: 'new', runId: 1, tick: 1, time: 0, distance: 0, position: [0, 1, 0] as const, intensity: 1 };
  manager.handle({ ...base, type: 'powerup-collected', powerup: 'magnet', entityId: 'p' }, palette);
  expect(context.voices.at(-1)?.rate).toBe(1.35);
  manager.handle({ ...base, id: 'break', tick: 2, type: 'shield-broken', powerup: 'shield', entityId: 'obstacle' }, palette);
  expect(context.voices.at(-1)?.rate).toBe(1.6);
  manager.handle({ ...base, id: 'buy', tick: 3, type: 'upgrade-purchased' }, palette);
  expect(context.voices.at(-1)?.rate).toBe(1.2);
  for (let i = 0; i < 100; i++) manager.handle({ ...base, id: `new${i}`, tick: 4, type: 'mission-completed' }, palette);
  expect(manager.diagnostics().activeContexts).toBe(1); expect(manager.diagnostics().bufferCount).toBe(16); expect(manager.diagnostics().activeVoices).toBeLessThanOrEqual(12);
  await manager.dispose(); expect(context.closeCount).toBe(1);
});
