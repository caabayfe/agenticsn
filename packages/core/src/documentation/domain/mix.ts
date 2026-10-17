import { type Cue, estimateTimeline, type Timeline } from "./scene";
import { SAMPLE_RATE } from "./synth";

// The SNDOC mix (tools/mix.py), sample for sample in arithmetic: voice levelled to -19 dB RMS,
// a whoosh before and a pop after each step, extra cues, a closing sound, a music bed levelled
// to -21 dB RMS that ducks under the voice, fades, and a soft limiter. Without voice the steps
// follow the player's estimate, so the visuals and the track stay in time.

export const MIX = {
  lead: 0.7,
  voiceDelay: 0.35,
  gap: 0.95,
  tail: 2.2,
  voiceRmsDb: -19,
  bedRmsDb: -21,
  duckDb: -9.5,
  duckAttack: 0.25,
  duckRelease: 0.7,
  duckThreshold: 0.02,
  bedFadeIn: 1.2,
  bedFadeOut: 2.6,
  bedGainDb: -3,
  whooshDb: -21,
  whooshLead: 0.12,
  popDb: -25,
  popAfter: 0.45,
  resolveDb: -22,
  resolveBeforeEnd: 3.2,
  limit: 0.97,
} as const;

export interface MixInput {
  readonly steps: readonly { readonly say: string }[];
  // One clip per step when narrated (decoded at SAMPLE_RATE, mono); null for no voice.
  readonly voice: readonly Float32Array[] | null;
  // The music bed for a track of that many seconds; null for none.
  readonly bed: ((seconds: number) => Float32Array) | null;
  readonly sound: (name: string) => Float32Array | null;
  readonly cues: readonly Cue[];
}

export interface MixResult {
  readonly samples: Float32Array;
  readonly timeline: Timeline;
  // Cue sounds that do not exist: left out of the track.
  readonly missingSounds: readonly string[];
}

export const dbToGain = (db: number) => 10 ** (db / 20);
const round3 = (value: number) => Math.round(value * 1000) / 1000;

// Scales x so the RMS of its samples with |x| > 0.01 is `targetDb`.
export function rmsNormalize(samples: Float32Array, targetDb: number): Float32Array {
  let sum = 0;
  let count = 0;
  for (const value of samples) {
    if (Math.abs(value) > 0.01) {
      sum += value * value;
      count++;
    }
  }
  const rms = count === 0 ? 1e-6 : Math.sqrt(sum / count);
  const gain = dbToGain(targetDb) / rms;
  return samples.map((value) => value * gain);
}

function place(target: Float32Array, clip: Float32Array, seconds: number, gain = 1): void {
  const start = Math.floor(seconds * SAMPLE_RATE);
  const end = Math.min(target.length, start + clip.length);
  for (let i = Math.max(0, start); i < end; i++) {
    target[i] = (target[i] ?? 0) + (clip[i - start] ?? 0) * gain;
  }
}

// 0..1 ducking envelope from "voice present", in 5 ms blocks.
export function duckEnvelope(voice: Float32Array): Float32Array {
  const block = 240;
  const attack = (1 / (MIX.duckAttack * SAMPLE_RATE)) * block;
  const release = (1 / (MIX.duckRelease * SAMPLE_RATE)) * block;
  const envelope = new Float32Array(voice.length);
  let level = 0;
  for (let start = 0; start < voice.length; start += block) {
    let present = false;
    for (let i = start; i < Math.min(voice.length, start + block); i++) {
      if (Math.abs(voice[i] ?? 0) > MIX.duckThreshold) {
        present = true;
        break;
      }
    }
    const target = present ? 1 : 0;
    level = target > level ? Math.min(target, level + attack) : Math.max(target, level - release);
    envelope.fill(level, start, Math.min(voice.length, start + block));
  }
  return envelope;
}

function voicedTimeline(clips: readonly Float32Array[]): Timeline {
  const starts: number[] = [];
  let at = MIX.lead;
  for (const clip of clips) {
    starts.push(round3(at));
    at += MIX.voiceDelay + clip.length / SAMPLE_RATE + MIX.gap;
  }
  return { starts, total: round3(at - MIX.gap + MIX.tail) };
}

function effects(input: MixInput, timeline: Timeline, length: number, missing: Set<string>) {
  const fx = new Float32Array(length);
  const add = (name: string, seconds: number, db: number) => {
    const clip = input.sound(name);
    if (clip === null) {
      missing.add(name);
    } else {
      place(fx, clip, seconds, dbToGain(db));
    }
  };
  timeline.starts.forEach((start, index) => {
    add(`whoosh_${index % 3}`, Math.max(0, start - MIX.whooshLead), MIX.whooshDb);
    add(`ui_pop_${index % 3}`, start + MIX.popAfter, MIX.popDb);
  });
  for (const cue of input.cues) {
    const start = timeline.starts[cue.step];
    if (start !== undefined) {
      add(cue.sound, start + cue.offset, cue.db);
    }
  }
  add("resolve_0", timeline.total - MIX.resolveBeforeEnd, MIX.resolveDb);
  return fx;
}

function bedTrack(bed: Float32Array, voice: Float32Array): Float32Array {
  const length = voice.length;
  const padded = new Float32Array(length);
  padded.set(bed.subarray(0, length));
  const levelled = rmsNormalize(padded, MIX.bedRmsDb);
  const duck = duckEnvelope(voice);
  const ducked = dbToGain(MIX.duckDb);
  const fadeIn = Math.round(MIX.bedFadeIn * SAMPLE_RATE);
  const fadeOut = Math.round(MIX.bedFadeOut * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const d = duck[i] ?? 0;
    let gain = 1 - d + d * ducked;
    if (i < fadeIn) {
      gain *= i / Math.max(1, fadeIn - 1);
    }
    if (i >= length - fadeOut) {
      gain *= (length - 1 - i) / Math.max(1, fadeOut - 1);
    }
    levelled[i] = (levelled[i] ?? 0) * gain;
  }
  return levelled;
}

function limited(mix: Float32Array): Float32Array {
  let peak = 0;
  for (const value of mix) {
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak <= MIX.limit) {
    return mix;
  }
  const norm = Math.tanh(1.4);
  return mix.map((value) => (Math.tanh((value / peak) * 1.4) / norm) * MIX.limit);
}

export function mixTrack(input: MixInput): MixResult {
  const clips = input.voice?.map((clip) => rmsNormalize(clip, MIX.voiceRmsDb)) ?? null;
  const timeline = clips === null ? estimateTimeline(input.steps) : voicedTimeline(clips);
  const length = Math.ceil(timeline.total * SAMPLE_RATE);
  const voice = new Float32Array(length);
  clips?.forEach((clip, index) => {
    place(voice, clip, (timeline.starts[index] ?? 0) + MIX.voiceDelay);
  });
  const missing = new Set<string>();
  const fx = effects(input, timeline, length, missing);
  const bed =
    input.bed === null ? new Float32Array(length) : bedTrack(input.bed(timeline.total), voice);
  const bedGain = dbToGain(MIX.bedGainDb);
  const mix = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    mix[i] = (voice[i] ?? 0) + (bed[i] ?? 0) * bedGain + (fx[i] ?? 0);
  }
  return { samples: limited(mix), timeline, missingSounds: [...missing] };
}
