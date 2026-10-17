import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AudioAssets, AudioCodec } from "@snagentic/core";

const EXTENSIONS = ["wav", "flac", "mp3", "ogg", "m4a", "aiff"];
const NAME = /^[a-z0-9_]+$/;

// documentation/audio/bed.<ext> and documentation/audio/sounds/<name>.<ext>, decoded by ffmpeg.
export class FsAudioAssets implements AudioAssets {
  constructor(
    private readonly folder: string,
    private readonly codec: AudioCodec,
  ) {}

  private find(base: string): string | null {
    for (const extension of EXTENSIONS) {
      const path = `${base}.${extension}`;
      if (existsSync(path)) {
        return path;
      }
    }
    return null;
  }

  async bed(signal: AbortSignal): Promise<Float32Array | null> {
    const path = this.find(join(this.folder, "bed"));
    return path === null ? null : this.codec.decode(path, signal);
  }

  async sound(name: string, signal: AbortSignal): Promise<Float32Array | null> {
    const path = NAME.test(name) ? this.find(join(this.folder, "sounds", name)) : null;
    return path === null ? null : this.codec.decode(path, signal);
  }
}
