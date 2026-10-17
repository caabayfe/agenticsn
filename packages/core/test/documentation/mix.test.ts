import { describe, expect, it } from "bun:test";
import {
  dbToGain,
  duckEnvelope,
  estimateTimeline,
  MIX,
  mixTrack,
  rmsNormalize,
  SAMPLE_RATE,
  SYNTH_SOUND_NAMES,
  synthBed,
  synthSound,
} from "@snagentic/core";

const steps = [{ say: "one two three four five six" }, { say: "seven" }];
const sine = (seconds: number, amplitude = 0.3) =>
  Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE),
  );
const rmsDb = (samples: Float32Array, from: number, to: number) => {
  let sum = 0;
  const a = Math.floor(from * SAMPLE_RATE);
  const b = Math.floor(to * SAMPLE_RATE);
  for (let i = a; i < b; i++) {
    sum += (samples[i] ?? 0) ** 2;
  }
  return 20 * Math.log10(Math.sqrt(sum / (b - a)));
};

describe("the timeline", () => {
  it("follows the voice clips: lead 0.7 s, voice 0.35 s after each start, 0.95 s gap, 2.2 s tail", () => {
    const result = mixTrack({
      steps,
      voice: [sine(2), sine(1)],
      bed: null,
      sound: synthSound,
      cues: [],
    });
    expect(result.timeline.starts).toEqual([0.7, 0.7 + 0.35 + 2 + 0.95]);
    expect(result.timeline.total).toBeCloseTo(0.7 + 0.35 + 2 + 0.95 + 0.35 + 1 + 2.2, 3);
    expect(result.samples.length).toBe(Math.ceil(result.timeline.total * SAMPLE_RATE));
  });

  it("follows the player's estimate when there is no voice, so pictures and sound agree", () => {
    const result = mixTrack({ steps, voice: null, bed: synthBed, sound: synthSound, cues: [] });
    expect(result.timeline).toEqual(estimateTimeline(steps));
  });
});

describe("levels", () => {
  it("levels the active part of a clip to the target RMS", () => {
    const input = sine(1, 0.05);
    const levelled = rmsNormalize(input, -19);
    const active = levelled.filter((_, i) => Math.abs(input[i] ?? 0) > 0.01);
    const rms = Math.sqrt(active.reduce((sum, value) => sum + value * value, 0) / active.length);
    expect(20 * Math.log10(rms)).toBeCloseTo(-19, 4);
  });

  it("ducks the bed under the voice and lets it back up after", () => {
    const voice = new Float32Array(SAMPLE_RATE * 4);
    voice.set(sine(1, 0.5), SAMPLE_RATE);
    const envelope = duckEnvelope(voice);
    expect(envelope[0]).toBe(0);
    expect(envelope[Math.floor(SAMPLE_RATE * 1.9)]).toBe(1);
    expect(envelope[SAMPLE_RATE * 4 - 1]).toBe(0);
  });

  it("keeps the narrated mix under the limit, with the bed lower while the voice speaks", () => {
    const bed = synthBed;
    const voiced = mixTrack({
      steps,
      voice: [sine(3, 0.9), sine(3, 0.9)],
      bed,
      sound: synthSound,
      cues: [],
    });
    let peak = 0;
    for (const value of voiced.samples) {
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeLessThanOrEqual(MIX.limit + 1e-6);
    const silent = mixTrack({
      steps,
      voice: null,
      bed,
      sound: () => new Float32Array(0),
      cues: [],
    });
    expect(rmsDb(silent.samples, 3, 4)).toBeLessThan(MIX.bedRmsDb + MIX.bedGainDb + 1);
  });

  it("converts decibels to gain", () => {
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6);
  });
});

describe("sounds", () => {
  it("synthesises every named sound as a short clip that does not clip", () => {
    for (const name of SYNTH_SOUND_NAMES) {
      const clip = synthSound(name) ?? new Float32Array(0);
      expect(clip.length).toBeGreaterThan(1000);
      expect(Math.max(...clip.map(Math.abs))).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

  it("has every sound the SNDOC cues used, the same on every run", () => {
    for (const name of [
      "whoosh_0",
      "ui_pop_2",
      "resolve_0",
      "scan_0",
      "stamp_0",
      "success_0",
      "alert_0",
    ]) {
      expect(SYNTH_SOUND_NAMES).toContain(name);
    }
    expect(synthSound("whoosh_1")).toEqual(synthSound("whoosh_1") ?? new Float32Array(0));
    expect(synthSound("nope")).toBeNull();
  });

  it("places step sounds and cues, and reports cue sounds that do not exist", () => {
    const placed: string[] = [];
    const result = mixTrack({
      steps,
      voice: null,
      bed: null,
      sound: (name) => {
        placed.push(name);
        return name === "missing_9" ? null : synthSound(name);
      },
      cues: [
        { step: 1, offset: 0.8, sound: "scan_0", db: -24 },
        { step: 5, offset: 0.8, sound: "alert_0", db: -24 },
        { step: 0, offset: 0.5, sound: "missing_9", db: -24 },
      ],
    });
    expect(placed).toEqual([
      "whoosh_0",
      "ui_pop_0",
      "whoosh_1",
      "ui_pop_1",
      "scan_0",
      "missing_9",
      "resolve_0",
    ]);
    expect(result.missingSounds).toEqual(["missing_9"]);
  });
});
