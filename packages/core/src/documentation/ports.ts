import type { MirrorRecord } from "./domain/evidence";

// A page file as read: front matter parsed from YAML (unknown until validated) and the body.
export interface PageSource {
  readonly path: string;
  readonly frontMatter: unknown;
  readonly body: string;
}

export interface SceneSource {
  // animations/<name>
  readonly path: string;
  readonly animation: unknown;
  readonly svg: string;
  readonly css: string | null;
  readonly steps: unknown;
}

// The workspace's documentation/ folder.
export interface DocumentationSources {
  // site.yaml parsed, or null when the workspace has no documentation.
  site(): Promise<unknown>;
  // processes/<id>/process.yaml, parsed.
  processes(): Promise<readonly { readonly path: string; readonly process: unknown }[]>;
  pages(): Promise<readonly PageSource[]>;
  scenes(): Promise<readonly SceneSource[]>;
  // Sets evidence.<id>.hash in a page's front matter, keeping the rest of the file as written.
  pinHashes(path: string, hashes: ReadonlyMap<string, string>): Promise<void>;
}

// The instance's mirror, read only.
export interface MirrorRecords {
  read(table: string, sysId: string): Promise<MirrorRecord | null>;
  head(): Promise<string | null>;
}

export interface MarkdownRenderer {
  html(markdown: string): string;
}

// Where a built site goes. Replaces the previous build.
export interface SiteOutput {
  readonly root: string;
  replace(
    files: readonly { readonly path: string; readonly content: string | Uint8Array }[],
  ): Promise<void>;
}

// ffmpeg: decodes any audio file to mono float samples at SAMPLE_RATE, encodes the mix.
export interface AudioCodec {
  available(): Promise<boolean>;
  decode(path: string, signal: AbortSignal): Promise<Float32Array>;
  // Loudness-normalised MP3 of mono samples at SAMPLE_RATE.
  encodeMp3(samples: Float32Array, signal: AbortSignal): Promise<Uint8Array>;
}

// A text-to-speech engine (Piper, the operating system's voice…), returning mono samples at
// SAMPLE_RATE. Adapters may cache by text.
export interface VoiceSynthesizer {
  readonly name: string;
  available(): Promise<boolean>;
  speak(text: string, signal: AbortSignal): Promise<Float32Array>;
}

// A workspace's own sounds (documentation/audio/): bed.<ext> and sounds/<name>.<ext>. Null
// when absent: the synthesised default is used.
export interface AudioAssets {
  bed(signal: AbortSignal): Promise<Float32Array | null>;
  sound(name: string, signal: AbortSignal): Promise<Float32Array | null>;
}

export interface MediaTools {
  readonly codec: AudioCodec;
  readonly voices: readonly VoiceSynthesizer[];
  readonly assets: AudioAssets;
}
