import { base64 } from "../domain/base64";
import { MediaToolMissingError, UnknownVoiceError } from "../domain/media-errors";
import { mixTrack } from "../domain/mix";
import type { PlayerMedia } from "../domain/player";
import type { Scene } from "../domain/scene";
import { synthBed, synthSound } from "../domain/synth";
import type { MediaTools, VoiceSynthesizer } from "../ports";

export interface AudioOptions {
  // "none" for music and effects only; otherwise the name of a voice adapter.
  readonly voice: string;
}

export interface AudioTrack {
  readonly media: PlayerMedia;
  readonly mp3: Uint8Array;
  readonly missingSounds: readonly string[];
}

const STEP_SOUNDS = [
  "whoosh_0",
  "whoosh_1",
  "whoosh_2",
  "ui_pop_0",
  "ui_pop_1",
  "ui_pop_2",
  "resolve_0",
];

function chooseVoice(tools: MediaTools, name: string): VoiceSynthesizer | null {
  if (name === "none") {
    return null;
  }
  const voice = tools.voices.find((candidate) => candidate.name === name);
  if (voice === undefined) {
    throw new UnknownVoiceError(
      name,
      tools.voices.map((candidate) => candidate.name),
    );
  }
  return voice;
}

// One animation's audio track (phase 2, ADR-0034): music and effects always, the voice when
// asked. The workspace's own bed and sounds replace the synthesised ones.
export async function audioTrack(
  tools: MediaTools,
  scene: Scene,
  options: AudioOptions,
  signal: AbortSignal,
): Promise<AudioTrack> {
  if (!(await tools.codec.available())) {
    throw new MediaToolMissingError(
      "ffmpeg",
      "install ffmpeg (brew install ffmpeg), or build without --audio",
    );
  }
  const voice = chooseVoice(tools, options.voice);
  if (voice !== null && !(await voice.available())) {
    throw new MediaToolMissingError(
      `the ${voice.name} voice`,
      "install it, choose another --voice, or use --voice none",
    );
  }
  const clips: Float32Array[] = [];
  if (voice !== null) {
    for (const step of scene.steps) {
      signal.throwIfAborted();
      clips.push(await voice.speak(step.say, signal));
    }
  }
  const ownBed = await tools.assets.bed(signal);
  const sounds = new Map<string, Float32Array | null>();
  for (const name of new Set([...STEP_SOUNDS, ...scene.cues.map((cue) => cue.sound)])) {
    sounds.set(name, (await tools.assets.sound(name, signal)) ?? synthSound(name));
  }
  const mixed = mixTrack({
    steps: scene.steps,
    voice: voice === null ? null : clips,
    bed: (seconds) => ownBed ?? synthBed(seconds),
    sound: (name) => sounds.get(name) ?? null,
    cues: scene.cues,
  });
  const mp3 = await tools.codec.encodeMp3(mixed.samples, signal);
  return {
    media: { audio: { mimeType: "audio/mpeg", base64: base64(mp3) }, timeline: mixed.timeline },
    mp3,
    missingSounds: mixed.missingSounds,
  };
}
