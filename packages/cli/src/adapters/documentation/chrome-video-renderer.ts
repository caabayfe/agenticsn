import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CapturedFrame,
  concatList,
  frameSchedule,
  type VideoOptions,
  type VideoRenderer,
} from "@snagentic/core";
import { DevToolsClient, field } from "./devtools-client";
import { MediaToolFailedError, runTool, toolAvailable } from "./run-tool";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function chromeProgram(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return env["SNAGENTIC_CHROME"] ?? CANDIDATES.find((path) => existsSync(path));
}

const WIDTH = 1040;

async function devToolsUrl(profile: string, signal: AbortSignal): Promise<string> {
  const file = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150 && !signal.aborted; attempt++) {
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, "utf8").split("\n");
      if (port && path) {
        return `ws://127.0.0.1:${port}${path}`;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error("the browser did not start its DevTools endpoint");
}

async function evaluate(client: DevToolsClient, expression: string): Promise<unknown> {
  const reply = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const result =
    typeof reply === "object" && reply !== null ? Reflect.get(reply, "result") : undefined;
  return typeof result === "object" && result !== null ? Reflect.get(result, "value") : undefined;
}

// Records the animation in real time through Chrome's screencast (CSS transitions don't follow
// DevTools virtual time: spike S20), then lets ffmpeg resample to a constant frame rate.
async function capture(client: DevToolsClient, dir: string, url: string, options: VideoOptions) {
  await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
  const height = Number(
    await evaluate(
      client,
      "Math.ceil(document.querySelector('.wrap').getBoundingClientRect().height)",
    ),
  );
  const even = Math.ceil((Number.isFinite(height) && height > 0 ? height : 700) / 2) * 2;
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: even,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const frames: CapturedFrame[] = [];
  const writes: Promise<void>[] = [];
  client.on("Page.screencastFrame", (params) => {
    const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
    const metadata =
      typeof params === "object" && params !== null ? Reflect.get(params, "metadata") : undefined;
    const timestamp = Number(
      typeof metadata === "object" && metadata !== null ? Reflect.get(metadata, "timestamp") : 0,
    );
    frames.push({ file, timestamp });
    writes.push(writeFile(join(dir, file), Buffer.from(field(params, "data"), "base64")));
    const ack =
      typeof params === "object" && params !== null ? Reflect.get(params, "sessionId") : 0;
    void client.send("Page.screencastFrameAck", { sessionId: ack });
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
  await Bun.sleep(300);
  const start = Number(await evaluate(client, "window.snagenticPlayer.start()"));
  await Bun.sleep((options.seconds + 0.4) * 1000);
  await client.send("Page.stopScreencast");
  await Promise.all(writes);
  return frameSchedule(frames, start, options.seconds);
}

async function encode(
  dir: string,
  list: string,
  audio: string | null,
  options: VideoOptions,
  signal: AbortSignal,
) {
  const out = join(dir, "video.mp4");
  const args = [
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    ...(audio === null ? [] : ["-i", audio]),
    "-vf",
    `fps=${options.fps},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    ...(audio === null ? [] : ["-c:a", "aac", "-b:a", "128k"]),
    "-t",
    options.seconds.toFixed(3),
    "-movflags",
    "+faststart",
    out,
  ];
  const result = await runTool(args, signal);
  if (result.exitCode !== 0) {
    throw new MediaToolFailedError("ffmpeg", result.stderr);
  }
  return new Uint8Array(await readFile(out));
}

export class ChromeVideoRenderer implements VideoRenderer {
  constructor(private readonly chrome: string | undefined) {}

  async available(): Promise<boolean> {
    return (
      this.chrome !== undefined &&
      existsSync(this.chrome) &&
      toolAvailable(["ffmpeg", "-hide_banner", "-version"])
    );
  }

  async render(page: string, audio: Uint8Array | null, options: VideoOptions, signal: AbortSignal) {
    const dir = await mkdtemp(join(tmpdir(), "snagentic-video-"));
    const browser = Bun.spawn(
      [
        this.chrome ?? "chrome",
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${join(dir, "profile")}`,
        "--hide-scrollbars",
        "--mute-audio",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore", signal },
    );
    let client: DevToolsClient | undefined;
    try {
      await writeFile(join(dir, "player.html"), page);
      const audioFile = audio === null ? null : join(dir, "audio.mp3");
      if (audioFile !== null && audio !== null) {
        await writeFile(audioFile, audio);
      }
      client = await DevToolsClient.connect(await devToolsUrl(join(dir, "profile"), signal));
      await client.attachPage();
      const url = `file://${join(dir, "player.html")}#record${options.subtitles ? "&subs" : ""}`;
      const schedule = await capture(client, dir, url, options);
      if (schedule.length === 0) {
        throw new Error("the browser sent no frames");
      }
      await writeFile(join(dir, "frames.txt"), concatList(schedule));
      return await encode(dir, join(dir, "frames.txt"), audioFile, options, signal);
    } finally {
      client?.close();
      browser.kill();
      await browser.exited;
      await rm(dir, { recursive: true, force: true });
    }
  }
}
