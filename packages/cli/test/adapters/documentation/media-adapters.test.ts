import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_RATE, type VoiceSynthesizer } from "@snagentic/core";
import { FfmpegCodec } from "../../../src/adapters/documentation/ffmpeg-codec";
import { FsAudioAssets } from "../../../src/adapters/documentation/fs-audio-assets";
import { mediaTools, piperLocation } from "../../../src/adapters/documentation/media-tools";
import { runTool, toolAvailable } from "../../../src/adapters/documentation/run-tool";
import { CachedVoice, PiperVoice, SystemVoice } from "../../../src/adapters/documentation/voices";

// Media programs are optional on a machine: these tests run where they are installed.
const HAS_FFMPEG = await toolAvailable(["ffmpeg", "-hide_banner", "-version"]);
const HAS_SAY = process.platform === "darwin" && existsSync("/usr/bin/say");
const PIPER = piperLocation(process.env, process.env["HOME"] ?? "");
const signal = new AbortController().signal;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "snagentic-media-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const tone = (seconds: number) =>
  Float32Array.from(
    { length: seconds * SAMPLE_RATE },
    (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE),
  );

describe("running media programs", () => {
  it("reports a program that is not installed as unavailable", async () => {
    expect(await toolAvailable(["snagentic-no-such-program"])).toBe(false);
  });

  it("passes standard input and returns standard output and the exit code", async () => {
    const result = await runTool(["cat"], signal, new TextEncoder().encode("hi"));
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe("hi");
  });
});

describe.skipIf(!HAS_FFMPEG)("ffmpeg", () => {
  const codec = new FfmpegCodec();

  it("encodes a mix as MP3 and decodes it back to mono samples at the mix rate", async () => {
    expect(await codec.available()).toBe(true);
    const mp3 = await codec.encodeMp3(tone(2), signal);
    expect([...mp3.subarray(0, 3)]).toEqual([0x49, 0x44, 0x33]);
    writeFileSync(join(dir, "a.mp3"), mp3);
    const back = await codec.decode(join(dir, "a.mp3"), signal);
    expect(Math.abs(back.length - 2 * SAMPLE_RATE)).toBeLessThan(SAMPLE_RATE * 0.1);
  });

  it("explains a file it cannot decode", async () => {
    writeFileSync(join(dir, "bad.wav"), "not audio");
    await expect(codec.decode(join(dir, "bad.wav"), signal)).rejects.toThrow(/ffmpeg failed/);
  });

  it("reads the workspace's own bed and sounds, and nothing else", async () => {
    mkdirSync(join(dir, "sounds"), { recursive: true });
    const mp3 = await codec.encodeMp3(tone(1), signal);
    writeFileSync(join(dir, "bed.mp3"), mp3);
    writeFileSync(join(dir, "sounds", "scan_0.mp3"), mp3);
    const assets = new FsAudioAssets(dir, codec);
    expect((await assets.bed(signal))?.length).toBeGreaterThan(0);
    expect((await assets.sound("scan_0", signal))?.length).toBeGreaterThan(0);
    expect(await assets.sound("alert_0", signal)).toBeNull();
    expect(await assets.sound("../bed", signal)).toBeNull();
    expect(await new FsAudioAssets(join(dir, "none"), codec).bed(signal)).toBeNull();
  });

  it.skipIf(!HAS_SAY)("speaks with the operating system's voice", async () => {
    const voice = new SystemVoice(codec);
    expect(await voice.available()).toBe(true);
    expect((await voice.speak("Hello.", signal)).length).toBeGreaterThan(SAMPLE_RATE * 0.2);
  });

  it.skipIf(PIPER.model === undefined)("speaks with Piper", async () => {
    const voice = new PiperVoice(codec, PIPER.program, PIPER.model);
    expect(await voice.available()).toBe(true);
    expect(
      (await voice.speak("The incident moves to in progress.", signal)).length,
    ).toBeGreaterThan(SAMPLE_RATE);
  });
});

// Stand-ins for the voice programs: write a short tone where the real one writes speech.
function fakeProgram(name: string, outFlag: string, failing = false): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    failing
      ? "#!/bin/sh\necho 'no voice' >&2\nexit 3\n"
      : `#!/bin/sh\n[ "$1" = "--help" ] || [ "$1" = "--version" ] && exit 0\nout=""\nwhile [ $# -gt 0 ]; do [ "$1" = "${outFlag}" ] && out="$2"; shift; done\nexec ffmpeg -v error -y -f lavfi -i sine=frequency=300:duration=0.5 "$out"\n`,
    { mode: 0o755 },
  );
  return path;
}

describe.skipIf(!HAS_FFMPEG)("voice programs", () => {
  const codec = new FfmpegCodec();

  it("runs Piper with the model and decodes what it writes", async () => {
    const model = join(dir, "voice.onnx");
    writeFileSync(model, "");
    const voice = new PiperVoice(codec, fakeProgram("piper", "-f"), model);
    expect(await voice.available()).toBe(true);
    expect((await voice.speak("Hello.", signal)).length).toBeGreaterThan(SAMPLE_RATE * 0.4);
  });

  it("runs the system voice as espeak-ng off macOS", async () => {
    const voice = new SystemVoice(codec, "linux", fakeProgram("espeak-ng", "-w"));
    expect(await voice.available()).toBe(true);
    expect((await voice.speak("Hello.", signal)).length).toBeGreaterThan(SAMPLE_RATE * 0.4);
  });

  it("reports a voice program that fails", async () => {
    const model = join(dir, "voice.onnx");
    writeFileSync(model, "");
    const failing = fakeProgram("broken", "-f", true);
    await expect(new PiperVoice(codec, failing, model).speak("x", signal)).rejects.toThrow(
      /piper failed: no voice/,
    );
    await expect(new SystemVoice(codec, "linux", failing).speak("x", signal)).rejects.toThrow(
      /system failed/,
    );
  });

  it("looks for say on macOS", async () => {
    expect(await new SystemVoice(codec, "darwin", join(dir, "no-say")).available()).toBe(false);
  });
});

describe("voices", () => {
  it("are unavailable without a model or a program", async () => {
    const codec = new FfmpegCodec("snagentic-no-ffmpeg");
    expect(await new PiperVoice(codec, "piper", undefined).available()).toBe(false);
    expect(await new PiperVoice(codec, "snagentic-no-piper", join(dir, "x.onnx")).available()).toBe(
      false,
    );
    expect(await codec.available()).toBe(false);
  });

  it("keep each spoken line, so a rebuild narrates only what changed", async () => {
    let spoken = 0;
    const inner: VoiceSynthesizer = {
      name: "fake",
      available: async () => true,
      speak: async () => {
        spoken++;
        return Float32Array.from([0.1, 0.2, 0.3]);
      },
    };
    const voice = new CachedVoice(inner, dir);
    expect(voice.name).toBe("fake");
    expect(await voice.available()).toBe(true);
    expect([...(await voice.speak("same", signal))]).toEqual([
      ...Float32Array.from([0.1, 0.2, 0.3]),
    ]);
    expect([...(await voice.speak("same", signal))]).toEqual([
      ...Float32Array.from([0.1, 0.2, 0.3]),
    ]);
    await voice.speak("other", signal);
    expect(spoken).toBe(2);
  });

  it("find Piper from the environment first, then the snagentic install folder", () => {
    expect(piperLocation({ SNAGENTIC_PIPER: "/p", SNAGENTIC_PIPER_MODEL: "/m.onnx" }, dir)).toEqual(
      {
        program: "/p",
        model: "/m.onnx",
      },
    );
    mkdirSync(join(dir, ".local/share/snagentic/piper/voices"), { recursive: true });
    writeFileSync(join(dir, ".local/share/snagentic/piper/voices/b.onnx"), "");
    writeFileSync(join(dir, ".local/share/snagentic/piper/voices/a.onnx"), "");
    expect(piperLocation({}, dir)).toEqual({
      program: "piper",
      model: join(dir, ".local/share/snagentic/piper/voices/a.onnx"),
    });
    const tools = mediaTools(dir, {}, dir);
    expect(tools.voices.map((voice) => voice.name)).toEqual(["piper", "system"]);
  });

  it("write videos into the workspace's .snagentic/videos", async () => {
    const path = await mediaTools(dir, {}, dir).videos.write("asg", new Uint8Array([1, 2]));
    expect(path).toBe(join(dir, ".snagentic", "videos", "asg.mp4"));
    expect(existsSync(path)).toBe(true);
  });
});
