import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MediaTools } from "@snagentic/core";
import { FfmpegCodec } from "./ffmpeg-codec";
import { FsAudioAssets } from "./fs-audio-assets";
import { CachedVoice, PiperVoice, SystemVoice } from "./voices";

// Where `docs` looks for Piper when SNAGENTIC_PIPER and SNAGENTIC_PIPER_MODEL are not set.
export function piperLocation(env: Readonly<Record<string, string | undefined>>, home: string) {
  const root = join(home, ".local", "share", "snagentic", "piper");
  const installed = join(root, ".venv", "bin", "piper");
  const voices = join(root, "voices");
  const model =
    env["SNAGENTIC_PIPER_MODEL"] ??
    (existsSync(voices)
      ? readdirSync(voices)
          .filter((file) => file.endsWith(".onnx"))
          .sort()
          .map((file) => join(voices, file))[0]
      : undefined);
  return {
    program: env["SNAGENTIC_PIPER"] ?? (existsSync(installed) ? installed : "piper"),
    model,
  };
}

// ffmpeg, the voices (cached per workspace) and the workspace's own sounds.
export function mediaTools(
  workspace: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): MediaTools {
  const codec = new FfmpegCodec(env["SNAGENTIC_FFMPEG"] ?? "ffmpeg");
  const cache = join(workspace, ".snagentic", "docs-cache", "voices");
  const piper = piperLocation(env, home);
  return {
    codec,
    voices: [
      new CachedVoice(new PiperVoice(codec, piper.program, piper.model), cache),
      new CachedVoice(new SystemVoice(codec), cache),
    ],
    assets: new FsAudioAssets(join(workspace, "documentation", "audio"), codec),
  };
}
