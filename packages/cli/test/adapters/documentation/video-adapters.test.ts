import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScene, playerHtml } from "@snagentic/core";
import {
  ChromeVideoRenderer,
  chromeProgram,
  startBrowser,
} from "../../../src/adapters/documentation/chrome-video-renderer";
import { DevToolsClient, field } from "../../../src/adapters/documentation/devtools-client";
import { fakeProgram } from "../../support/fake-program";
import { mediaTestsRun } from "../../support/media-tests";

// Runs where Chrome and ffmpeg are installed; SNAGENTIC_TEST_MEDIA moves it to the media CI job,
// which installs ffmpeg on a runner image that has Chrome (spec 014, R1).
const CHROME = chromeProgram(process.env);
const RUN = mediaTestsRun(
  "Chrome and ffmpeg",
  CHROME !== undefined && (await new ChromeVideoRenderer(CHROME).available()),
);

describe("the browser", () => {
  it("is found from SNAGENTIC_CHROME first", () => {
    expect(chromeProgram({ SNAGENTIC_CHROME: "/x/chrome" })).toBe("/x/chrome");
  });

  it("is unavailable when there is none", async () => {
    expect(await new ChromeVideoRenderer(undefined).available()).toBe(false);
    expect(await new ChromeVideoRenderer("/no/such/chrome").available()).toBe(false);
  });

  it("reads string fields from protocol replies, and nothing else", () => {
    expect(field({ targetId: "t1" }, "targetId")).toBe("t1");
    expect(field({ targetId: 3 }, "targetId")).toBe("");
    expect(field(null, "targetId")).toBe("");
  });

  // CI's browser sometimes never writes its DevTools endpoint (2026-10-22): one fresh start.
  it("starts the browser again, with a fresh profile, when the first one gives no endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snagentic-fake-chrome-"));
    try {
      // Answers only on its second start: writes DevToolsActivePort into --user-data-dir.
      const program = await fakeProgram(
        dir,
        "chrome",
        [
          'import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
          'import { join } from "node:path";',
          `const count = ${JSON.stringify(join(dir, "starts"))};`,
          'appendFileSync(count, "x\\n");',
          'if (readFileSync(count, "utf8").trim().split("\\n").length >= 2) {',
          '  const flag = process.argv.find((arg) => arg.startsWith("--user-data-dir="));',
          '  const profile = (flag ?? "").slice("--user-data-dir=".length);',
          "  mkdirSync(profile, { recursive: true });",
          '  writeFileSync(join(profile, "DevToolsActivePort"), "9222\\n/devtools/browser/fake\\n");',
          "}",
          "await Bun.sleep(5000);",
        ].join("\n"),
      );
      const started = await startBrowser(program, dir, new AbortController().signal, 20);
      started.browser.kill();
      expect(started.url).toBe("ws://127.0.0.1:9222/devtools/browser/fake");
      expect((await readFile(join(dir, "starts"), "utf8")).trim().split("\n")).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("gives up after the second start gives no endpoint either", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snagentic-fake-chrome-"));
    try {
      const program = await fakeProgram(dir, "chrome", "await Bun.sleep(5000);");
      await expect(startBrowser(program, dir, new AbortController().signal, 10)).rejects.toThrow(
        /did not start its DevTools endpoint/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("refuses to connect where no browser listens", async () => {
    await expect(DevToolsClient.connect("ws://127.0.0.1:9/devtools/browser/x")).rejects.toThrow(
      /cannot connect/,
    );
  });

  it.skipIf(!RUN)(
    "records an animation as an H.264 MP4",
    async () => {
      const scene = parseScene("animations/demo", {
        animation: { name: "demo" },
        svg: '<svg viewBox="0 0 960 440"><g id="cam"><rect class="r g0" x="10" y="10" width="100" height="50"/></g></svg>',
        css: null,
        steps: [{ t: "One", c: "First", say: "one" }],
      });
      const video = await new ChromeVideoRenderer(CHROME).render(
        playerHtml(scene),
        null,
        { seconds: 2, fps: 15, subtitles: false },
        new AbortController().signal,
      );
      expect(new TextDecoder().decode(video.subarray(4, 8))).toBe("ftyp");
    },
    60_000,
  );
});
