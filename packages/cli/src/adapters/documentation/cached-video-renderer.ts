import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoOptions, VideoRenderer } from "@snagentic/core";

// Recording takes as long as the animation, so a video is kept by the hash of what it shows (the
// player page, its audio track and the options) and recorded again only when one of them changes.
// After a build, prune() drops the recordings that build didn't use.
export class CachedVideoRenderer implements VideoRenderer {
  private readonly used = new Set<string>();

  constructor(
    private readonly inner: VideoRenderer,
    private readonly folder: string,
  ) {}

  available(): Promise<boolean> {
    return this.inner.available();
  }

  async render(
    page: string,
    audio: Uint8Array | null,
    options: VideoOptions,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const hash = createHash("sha256")
      .update(JSON.stringify(options))
      .update("\n")
      .update(page)
      .update("\n")
      .update(audio === null ? "silent" : audio)
      .digest("hex");
    const file = join(this.folder, `${hash}.mp4`);
    this.used.add(`${hash}.mp4`);
    if (existsSync(file)) {
      return new Uint8Array(await readFile(file));
    }
    const video = await this.inner.render(page, audio, options, signal);
    await mkdir(this.folder, { recursive: true });
    await writeFile(file, video);
    return video;
  }

  async prune(signal: AbortSignal): Promise<number> {
    if (this.used.size === 0 || !existsSync(this.folder)) {
      return 0;
    }
    const stale = (await readdir(this.folder)).filter(
      (name) => name.endsWith(".mp4") && !this.used.has(name),
    );
    for (const name of stale) {
      signal.throwIfAborted();
      await rm(join(this.folder, name), { force: true });
    }
    return stale.length;
  }
}
