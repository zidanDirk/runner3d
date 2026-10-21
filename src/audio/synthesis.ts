import type { FeedbackKind } from '../feedback/types';

export const SOUND_IDS = ['coin', 'jump', 'land', 'slide', 'lane', 'collision', 'game-over', 'speed'] as const satisfies readonly FeedbackKind[];
export type SoundId = typeof SOUND_IDS[number];
export const AUDIO_PROVENANCE = 'Runner3D original procedural PCM v1: sine partials, chirps and seeded filtered noise; no downloaded recordings or external services.';

const DURATIONS: Readonly<Record<SoundId, number>> = { coin: .15, jump: .19, land: .17, slide: .24, lane: .105, collision: .28, 'game-over': .46, speed: .23 };
const PEAKS: Readonly<Record<SoundId, number>> = { coin: .18, jump: .16, land: .18, slide: .14, lane: .13, collision: .24, 'game-over': .16, speed: .14 };
export interface SynthesizedSound {
  readonly id: SoundId;
  readonly sampleRate: number;
  readonly duration: number;
  readonly samples: Float32Array;
  readonly peak: number;
  readonly rms: number;
  readonly provenance: string;
}
const TAU = Math.PI * 2;
const sine = (phase: number): number => Math.sin(TAU * phase);
const chirp = (t: number, start: number, end: number, duration: number): number => sine(start * t + (end - start) * t * t / (2 * duration));
function envelope(t: number, duration: number, attack = .008): number {
  if (t <= 0 || t >= duration) return 0;
  const enter = Math.sin(Math.min(1, t / attack) * Math.PI / 2) ** 2;
  const exit = Math.sin(Math.min(1, (duration - t) / .012) * Math.PI / 2) ** 2;
  return enter * exit * Math.pow(1 - t / duration, 1.25);
}

/** Same deterministic samples are used by the browser and offline analysis. No clock or gameplay PRNG. */
export function synthesizeSound(id: SoundId, sampleRate: number, neon = 0): SynthesizedSound {
  if (!SOUND_IDS.includes(id)) throw new Error(`Unknown sound: ${String(id)}`);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Audio sample rate must be an integer between 8000 and 192000Hz.');
  if (!Number.isFinite(neon)) throw new Error('Audio palette must be finite.');
  const style = Math.max(0, Math.min(1, neon));
  const duration = DURATIONS[id];
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  let seed = 0x6f2a9d31 ^ (SOUND_IDS.indexOf(id) + 1) * 0x45d9f3b;
  let filtered = 0;
  let previousFiltered = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / (samples.length - 1) * duration;
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = (seed >>> 0) / 0xffffffff * 2 - 1;
    const cutoff = id === 'slide' || id === 'lane' ? 1050 : 650;
    filtered += (1 - Math.exp(-TAU * cutoff / sampleRate)) * (noise - filtered);
    const softNoise = filtered - previousFiltered * .45;
    previousFiltered = filtered;
    let value = 0;
    switch (id) {
      case 'coin': {
        const fundamental = chirp(t, 760, 1050, duration);
        value = fundamental * .8 + sine(1520 * t) * (.10 + style * .09);
        break;
      }
      case 'jump': value = chirp(t, 180, 430, duration) * .78 + softNoise * .28 + chirp(t, 360, 860, duration) * style * .11; break;
      case 'land': value = chirp(t, 105, 52, duration) * .72 + softNoise * .48 + sine(185 * t) * style * .07; break;
      case 'slide': value = softNoise * .9 + chirp(t, 160, 90, duration) * .18 + sine(320 * t) * style * .07; break;
      case 'lane': value = softNoise * .7 + chirp(t, 260, 350, duration) * (.28 + style * .05); break;
      case 'collision': value = chirp(t, 125, 42, duration) * .7 + softNoise * .52 + sine(210 * t) * style * .08; break;
      case 'game-over': {
        // A brief baked-in rest separates the descending cue from the impact; no JavaScript timer.
        const noteTime = t - .065;
        if (noteTime > 0) {
          const f = noteTime < .10 ? 420 : noteTime < .21 ? 330 : 260;
          const localTime = noteTime < .10 ? noteTime : noteTime < .21 ? noteTime - .10 : noteTime - .21;
          const noteDuration = noteTime < .10 ? .10 : noteTime < .21 ? .11 : duration - .275;
          value = (sine(f * localTime) + sine(f * 2 * localTime) * (.08 + style * .08)) * envelope(localTime, noteDuration);
        }
        break;
      }
      case 'speed': value = chirp(t, 500, 750, duration) * .8 + sine(1000 * t) * (.08 + style * .10); break;
    }
    const sample = Math.tanh(value * 1.15) * envelope(t, duration);
    samples[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  // Deliberate headroom: at most 12 physical sources × .24 × .6 gain × .5 master = .864.
  const normalization = peak > 0 ? PEAKS[id] / peak : 0;
  let squares = 0;
  let finalPeak = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = (samples[i] ?? 0) * normalization;
    samples[i] = sample;
    squares += sample * sample;
    finalPeak = Math.max(finalPeak, Math.abs(sample));
  }
  return { id, sampleRate, duration: samples.length / sampleRate, samples, peak: finalPeak, rms: Math.sqrt(squares / samples.length), provenance: AUDIO_PROVENANCE };
}
