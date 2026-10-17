import { describe, expect, it } from "bun:test";
import {
  audioTrack,
  base64,
  MediaToolMissingError,
  type MediaTools,
  parseScene,
  UnknownVoiceError,
} from "@snagentic/core";

const scene = parseScene("animations/asg", {
  animation: { name: "asg", mix: { cues: [[0, 0.5, "scan_0", -24]] } },
  svg: '<svg><g id="cam"></g></svg>',
  css: null,
  steps: [
    { t: "A", c: "B", say: "First step." },
    { t: "C", c: "D", say: "Second step." },
  ],
});
const signal = new AbortController().signal;

function tools(overrides: Partial<{ ffmpeg: boolean; voice: boolean; bed: boolean }> = {}) {
  const spoken: string[] = [];
  const encoded: number[] = [];
  const media: MediaTools = {
    codec: {
      available: async () => overrides.ffmpeg ?? true,
      decode: async () => new Float32Array(0),
      encodeMp3: async (samples) => {
        encoded.push(samples.length);
        return new Uint8Array([7, 8]);
      },
    },
    voices: [
      {
        name: "piper",
        available: async () => overrides.voice ?? true,
        speak: async (text) => {
          spoken.push(text);
          return new Float32Array(48_000).fill(0.3);
        },
      },
    ],
    assets: {
      bed: async () => (overrides.bed ? new Float32Array(10).fill(0.1) : null),
      sound: async (name) => (name === "scan_0" ? new Float32Array(100).fill(0.5) : null),
    },
    video: { available: async () => false, render: async () => new Uint8Array(0) },
    videos: { write: async (name) => `/videos/${name}.mp4` },
  };
  return { media, spoken, encoded };
}

describe("audio tracks", () => {
  it("narrates each step with the chosen voice and embeds the encoded track", async () => {
    const { media, spoken } = tools();
    const track = await audioTrack(media, scene, { voice: "piper" }, signal);
    expect(spoken).toEqual(["First step.", "Second step."]);
    expect(track.media.audio).toEqual({ mimeType: "audio/mpeg", base64: "Bwg=" });
    expect(track.media.timeline.starts[0]).toBe(0.7);
    expect(track.missingSounds).toEqual([]);
  });

  it("has music and effects only with voice none, on the player's estimated timeline", async () => {
    const { media, spoken, encoded } = tools({ bed: true });
    const track = await audioTrack(media, scene, { voice: "none" }, signal);
    expect(spoken).toEqual([]);
    expect(track.media.timeline.starts[0]).toBe(0.6);
    expect(encoded[0]).toBe(Math.ceil(track.media.timeline.total * 48_000));
  });

  it("refuses without ffmpeg, with an unknown voice, or with a voice that is not installed", async () => {
    await expect(
      audioTrack(tools({ ffmpeg: false }).media, scene, { voice: "none" }, signal),
    ).rejects.toThrow(MediaToolMissingError);
    await expect(audioTrack(tools().media, scene, { voice: "elevenlabs" }, signal)).rejects.toThrow(
      UnknownVoiceError,
    );
    await expect(
      audioTrack(tools({ voice: false }).media, scene, { voice: "piper" }, signal),
    ).rejects.toThrow(/the piper voice is not available/);
  });

  it("encodes base64 like the standard", () => {
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      expect(base64(new TextEncoder().encode(text))).toBe(Buffer.from(text).toString("base64"));
    }
  });
});
