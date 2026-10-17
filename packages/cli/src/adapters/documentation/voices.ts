import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioCodec, VoiceSynthesizer } from "@snagentic/core";
import { MediaToolFailedError, runTool, toolAvailable } from "./run-tool";

async function withTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-voice-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Piper (local neural voice). The model is SNAGENTIC_PIPER_MODEL (an .onnx with its .json);
// the program is SNAGENTIC_PIPER or piper on the PATH. Install it under a short path: its
// bundled espeak-ng data fails to load from long ones.
export class PiperVoice implements VoiceSynthesizer {
  readonly name = "piper";

  constructor(
    private readonly codec: AudioCodec,
    private readonly program: string,
    private readonly model: string | undefined,
  ) {}

  async available(): Promise<boolean> {
    return (
      this.model !== undefined && existsSync(this.model) && toolAvailable([this.program, "--help"])
    );
  }

  speak(text: string, signal: AbortSignal): Promise<Float32Array> {
    return withTemp(async (dir) => {
      const out = join(dir, "line.wav");
      const input = join(dir, "line.txt");
      await writeFile(input, text);
      const result = await runTool(
        [this.program, "-m", this.model ?? "", "-i", input, "-f", out],
        signal,
      );
      if (result.exitCode !== 0) {
        throw new MediaToolFailedError("piper", result.stderr);
      }
      return this.codec.decode(out, signal);
    });
  }
}

// The operating system's voice: macOS `say`, or espeak-ng elsewhere.
export class SystemVoice implements VoiceSynthesizer {
  readonly name = "system";

  constructor(
    private readonly codec: AudioCodec,
    private readonly platform: string = process.platform,
    // Overrides the program (tests); default /usr/bin/say on macOS, espeak-ng elsewhere.
    private readonly program?: string,
  ) {}

  private get darwin(): boolean {
    return this.platform === "darwin";
  }

  private command(textFile: string, out: string): string[] {
    return this.darwin
      ? [this.program ?? "/usr/bin/say", "-f", textFile, "-o", out]
      : [this.program ?? "espeak-ng", "-f", textFile, "-w", out];
  }

  available(): Promise<boolean> {
    return this.darwin
      ? Promise.resolve(existsSync(this.program ?? "/usr/bin/say"))
      : toolAvailable([this.program ?? "espeak-ng", "--version"]);
  }

  speak(text: string, signal: AbortSignal): Promise<Float32Array> {
    return withTemp(async (dir) => {
      const textFile = join(dir, "line.txt");
      const out = join(dir, this.darwin ? "line.aiff" : "line.wav");
      await writeFile(textFile, text);
      const result = await runTool(this.command(textFile, out), signal);
      if (result.exitCode !== 0) {
        throw new MediaToolFailedError(this.name, result.stderr);
      }
      return this.codec.decode(out, signal);
    });
  }
}

// Keeps each spoken line, keyed by voice and text, so a rebuild only narrates what changed.
export class CachedVoice implements VoiceSynthesizer {
  readonly name: string;

  constructor(
    private readonly inner: VoiceSynthesizer,
    private readonly folder: string,
  ) {
    this.name = inner.name;
  }

  available(): Promise<boolean> {
    return this.inner.available();
  }

  async speak(text: string, signal: AbortSignal): Promise<Float32Array> {
    const file = join(
      this.folder,
      this.name,
      `${createHash("sha256").update(`${this.name}\n${text}`).digest("hex")}.f32`,
    );
    if (existsSync(file)) {
      const bytes = await readFile(file);
      return new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    }
    const samples = await this.inner.speak(text, signal);
    await mkdir(join(this.folder, this.name), { recursive: true });
    await writeFile(file, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    return samples;
  }
}
