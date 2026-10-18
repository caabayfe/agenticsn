import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoRenderer } from "@snagentic/core";
import { CachedVideoRenderer } from "../../../src/adapters/documentation/cached-video-renderer";

const signal = new AbortController().signal;
const OPTIONS = { seconds: 3, fps: 30, subtitles: true };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "snagentic-video-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function counting(available = true) {
  const calls: string[] = [];
  const inner: VideoRenderer = {
    available: async () => available,
    render: async (page) => {
      calls.push(page);
      return new Uint8Array([calls.length]);
    },
  };
  return { inner, calls };
}

describe("a video cache", () => {
  it("records an animation once and reuses the video while its page and track are the same", async () => {
    const { inner, calls } = counting();
    const video = new CachedVideoRenderer(inner, dir);
    const first = await video.render("<page>", new Uint8Array([1]), OPTIONS, signal);
    const again = await new CachedVideoRenderer(inner, dir).render(
      "<page>",
      new Uint8Array([1]),
      OPTIONS,
      signal,
    );
    expect([...again]).toEqual([...first]);
    expect(calls).toHaveLength(1);
  });

  it("records again when the page, the track or the options change", async () => {
    const { inner, calls } = counting();
    const video = new CachedVideoRenderer(inner, dir);
    await video.render("<page>", new Uint8Array([1]), OPTIONS, signal);
    await video.render("<page v2>", new Uint8Array([1]), OPTIONS, signal);
    await video.render("<page>", new Uint8Array([2]), OPTIONS, signal);
    await video.render("<page>", null, OPTIONS, signal);
    await video.render("<page>", new Uint8Array([1]), { ...OPTIONS, fps: 24 }, signal);
    expect(calls).toHaveLength(5);
  });

  it("is available when its browser is", async () => {
    expect(await new CachedVideoRenderer(counting(false).inner, dir).available()).toBe(false);
    expect(await new CachedVideoRenderer(counting(true).inner, dir).available()).toBe(true);
  });
});

describe("cleaning the video cache", () => {
  it("keeps only the recordings the last build used", async () => {
    const { inner, calls } = counting();
    const first = new CachedVideoRenderer(inner, dir);
    await first.render("<old page>", null, OPTIONS, signal);
    await first.render("<page>", null, OPTIONS, signal);
    const next = new CachedVideoRenderer(inner, dir);
    await next.render("<page>", null, OPTIONS, signal);
    expect(await next.prune(signal)).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);
    await new CachedVideoRenderer(inner, dir).render("<page>", null, OPTIONS, signal);
    expect(calls).toHaveLength(2);
  });

  it("removes nothing when the build recorded nothing, or the cache doesn't exist yet", async () => {
    const { inner } = counting();
    await new CachedVideoRenderer(inner, dir).render("<page>", null, OPTIONS, signal);
    expect(await new CachedVideoRenderer(inner, dir).prune(signal)).toBe(0);
    expect(readdirSync(dir)).toHaveLength(1);
    const absent = new CachedVideoRenderer(inner, join(dir, "none"));
    await absent.render("<page>", null, OPTIONS, signal);
    rmSync(join(dir, "none"), { recursive: true });
    expect(await absent.prune(signal)).toBe(0);
  });
});
