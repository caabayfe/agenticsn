import { type AudioCodec, SAMPLE_RATE } from "@snagentic/core";
import { MediaToolFailedError, runTool, toolAvailable } from "./run-tool";

// The SNDOC encode: loudness to -16 LUFS, 64 kbit/s mono MP3 at 44.1 kHz.
const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";
const MP3 = ["-codec:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1"];

function floats(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes.length - (bytes.length % 4));
  copy.set(bytes.subarray(0, copy.length));
  return new Float32Array(copy.buffer);
}

export class FfmpegCodec implements AudioCodec {
  constructor(private readonly ffmpeg = "ffmpeg") {}

  available(): Promise<boolean> {
    return toolAvailable([this.ffmpeg, "-hide_banner", "-version"]);
  }

  async decode(path: string, signal: AbortSignal): Promise<Float32Array> {
    const args = [
      this.ffmpeg,
      "-v",
      "error",
      "-i",
      path,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "-",
    ];
    const result = await runTool(args, signal);
    if (result.exitCode !== 0) {
      throw new MediaToolFailedError("ffmpeg", result.stderr);
    }
    return floats(result.stdout);
  }

  async encodeMp3(samples: Float32Array, signal: AbortSignal): Promise<Uint8Array> {
    const input = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const args = [
      this.ffmpeg,
      "-v",
      "error",
      "-f",
      "f32le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-af",
      LOUDNORM,
      ...MP3,
      "-f",
      "mp3",
      "pipe:1",
    ];
    const result = await runTool(args, signal, input);
    if (result.exitCode !== 0) {
      throw new MediaToolFailedError("ffmpeg", result.stderr);
    }
    return result.stdout;
  }
}
