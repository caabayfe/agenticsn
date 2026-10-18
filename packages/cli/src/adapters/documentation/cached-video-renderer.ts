import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoOptions, VideoRenderer } from "@snagentic/core";

// Recording takes as long as the animation, so a video is kept by the hash of what it shows (the
// player page, its audio track and the options) and recorded again only when one of them changes.
export class CachedVideoRenderer implements VideoRenderer {
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
    if (existsSync(file)) {
      return new Uint8Array(await readFile(file));
    }
    const video = await this.inner.render(page, audio, options, signal);
    await mkdir(this.folder, { recursive: true });
    await writeFile(file, video);
    return video;
  }
}
