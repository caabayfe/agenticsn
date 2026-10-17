// Default sounds, synthesised so an audio track needs no asset files: whooshes and pops on
// each step, cue sounds, a closing chime and a soft music bed. Deterministic (seeded noise), so
// a rebuild gives the same samples. A workspace can replace any of them with its own files.

export const SAMPLE_RATE = 48_000;

// A small seeded generator (mulberry32): noise without Math.random, the same on every run.
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

function peakNormalize(samples: Float32Array, peak = 0.8): Float32Array {
  let max = 0;
  for (const value of samples) {
    max = Math.max(max, Math.abs(value));
  }
  if (max > 0) {
    for (let i = 0; i < samples.length; i++) {
      samples[i] = ((samples[i] ?? 0) / max) * peak;
    }
  }
  return samples;
}

// Band-swept noise with a bell envelope.
function whoosh(variant: number): Float32Array {
  const seconds = 0.5 + 0.1 * variant;
  const out = buffer(seconds);
  const next = noise(17 + variant);
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * u);
    low += cutoff * (next() - low);
    out[i] = low * Math.sin(Math.PI * u) ** 2;
  }
  return peakNormalize(out);
}

function tone(
  frequencies: readonly number[],
  seconds: number,
  decay: number,
  start = 0,
): Float32Array {
  const out = buffer(seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let value = 0;
    frequencies.forEach((frequency, index) => {
      const onset = start * index;
      if (t >= onset) {
        const local = t - onset;
        const attack = Math.min(1, local / 0.004);
        value += attack * Math.exp(-local * decay) * Math.sin(2 * Math.PI * frequency * local);
      }
    });
    out[i] = value;
  }
  return peakNormalize(out);
}

function pop(variant: number): Float32Array {
  return tone([880 + 110 * variant, 1760 + 220 * variant], 0.14, 38);
}

const SOUNDS: Readonly<Record<string, () => Float32Array>> = {
  whoosh_0: () => whoosh(0),
  whoosh_1: () => whoosh(1),
  whoosh_2: () => whoosh(2),
  whoosh_3: () => whoosh(3),
  ui_pop_0: () => pop(0),
  ui_pop_1: () => pop(1),
  ui_pop_2: () => pop(2),
  resolve_0: () => tone([1046.5, 1318.5, 1568], 1.6, 3.2, 0.12),
  resolve_1: () => tone([784, 1046.5], 1.4, 3.5, 0.15),
  success_0: () => tone([659.3, 784, 1046.5], 0.9, 5, 0.08),
  success_1: () => tone([784, 987.8, 1174.7], 0.9, 5, 0.08),
  alert_0: () => tone([740, 554], 0.7, 4, 0.18),
  alert_1: () => tone([622, 466], 0.7, 4, 0.18),
  stamp_0: () => tone([110, 220], 0.35, 14),
  stamp_1: () => tone([98, 196], 0.35, 14),
  stamp_2: () => tone([123, 246], 0.35, 14),
  scan_0: () => tone([1200, 1500, 1800, 2100], 0.6, 9, 0.06),
  scan_1: () => tone([900, 1200, 1500], 0.6, 9, 0.06),
  riser_0: () => tone([220, 330, 440, 660], 1.2, 2, 0.2),
  riser_1: () => tone([196, 294, 392, 588], 1.2, 2, 0.2),
  logo_hit_0: () => tone([130.8, 261.6, 523.3], 1.4, 2.5),
  logo_hit_1: () => tone([146.8, 293.7, 587.3], 1.4, 2.5),
};

export const SYNTH_SOUND_NAMES: readonly string[] = Object.keys(SOUNDS);

export function synthSound(name: string): Float32Array | null {
  return SOUNDS[name]?.() ?? null;
}

// A quiet pad: four chords of four seconds each (A minor, F, C, G), soft attack, slow tremolo.
const CHORDS: readonly (readonly number[])[] = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [130.81, 196, 261.63],
  [196, 246.94, 293.66],
];

export function synthBed(seconds: number): Float32Array {
  const out = buffer(seconds);
  const chordLength = 4 * SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const chord = CHORDS[Math.floor(i / chordLength) % CHORDS.length] ?? [];
    const within = (i % chordLength) / chordLength;
    const swell = Math.sin(Math.PI * within) ** 0.6;
    const t = i / SAMPLE_RATE;
    const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
    let value = 0;
    for (const frequency of chord) {
      value +=
        Math.sin(2 * Math.PI * frequency * t) + 0.5 * Math.sin(2 * Math.PI * frequency * 1.003 * t);
    }
    out[i] = value * swell * tremolo;
  }
  return peakNormalize(out, 0.5);
}
