import { describe, expect, it } from "bun:test";
import {
  concatList,
  DocumentationSourceError,
  frameSchedule,
  MediaToolMissingError,
  type MediaTools,
  renderVideo,
} from "@snagentic/core";

describe("frame schedule", () => {
  it("starts from the picture shown at the start and holds each frame until the next", () => {
    const schedule = frameSchedule(
      [
        { file: "b.jpg", timestamp: 100.2 },
        { file: "a.jpg", timestamp: 99.9 },
        { file: "c.jpg", timestamp: 101.5 },
        { file: "late.jpg", timestamp: 104 },
      ],
      100,
      3,
    );
    expect(schedule.map((entry) => entry.file)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(schedule.map((entry) => Number(entry.duration.toFixed(3)))).toEqual([0.2, 1.3, 1.5]);
  });

  it("uses the first frame when none came before the start, and nothing without frames", () => {
    expect(frameSchedule([{ file: "a.jpg", timestamp: 5 }], 4, 2)).toEqual([
      { file: "a.jpg", duration: 2 },
    ]);
    expect(frameSchedule([], 0, 2)).toEqual([]);
  });

  it("writes the concat list with the last file repeated", () => {
    expect(concatList([{ file: "a.jpg", duration: 0.5 }])).toBe(
      "file 'a.jpg'\nduration 0.5000\nfile 'a.jpg'\n",
    );
    expect(concatList([])).toBe("\n");
  });
});

describe("docs video", () => {
  const sources = {
    site: async () => ({ title: "D", instance: "pdi2" }),
    processes: async () => [],
    pages: async () => [],
    scenes: async () => [
      {
        path: "animations/asg",
        animation: { name: "asg" },
        svg: '<svg><g id="cam"></g></svg>',
        css: null,
        steps: [{ t: "A", c: "B", say: "Hello." }],
      },
    ],
    pinHashes: async () => {},
  };
  const media = (browser: boolean) => {
    const rendered: { subtitles: boolean; page: string }[] = [];
    const tools: MediaTools = {
      codec: {
        available: async () => true,
        decode: async () => new Float32Array(0),
        encodeMp3: async () => new Uint8Array([1]),
      },
      voices: [
        {
          name: "piper",
          available: async () => true,
          speak: async () => new Float32Array(4800).fill(0.2),
        },
      ],
      assets: { bed: async () => null, sound: async () => null },
      video: {
        available: async () => browser,
        render: async (page, _audio, options) => {
          rendered.push({ subtitles: options.subtitles, page });
          return new Uint8Array([9, 9, 9]);
        },
      },
      videos: { write: async (name) => `/ws/.snagentic/videos/${name}.mp4` },
    };
    return { tools, rendered };
  };
  const run = { root: "/ws", signal: new AbortController().signal };

  it("records the animation with its narrated track and subtitles", async () => {
    const { tools, rendered } = media(true);
    const result = await renderVideo(
      { ...run, sources, media: tools },
      { animation: "asg", voice: "piper", fps: 30 },
    );
    expect(result).toMatchObject({ path: "/ws/.snagentic/videos/asg.mp4", bytes: 3 });
    expect(rendered[0]?.subtitles).toBe(true);
    expect(rendered[0]?.page).toContain("window.TIMING=");
  });

  it("names the animations it knows when asked for another, and needs a browser", async () => {
    await expect(
      renderVideo(
        { ...run, sources, media: media(true).tools },
        { animation: "nope", voice: "none", fps: 30 },
      ),
    ).rejects.toThrow(DocumentationSourceError);
    await expect(
      renderVideo(
        { ...run, sources, media: media(false).tools },
        { animation: "asg", voice: "none", fps: 30 },
      ),
    ).rejects.toThrow(MediaToolMissingError);
  });
});
