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
export interface ThemeFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface DocumentationSources {
  // site.yaml parsed, or null when the workspace has no documentation.
  site(): Promise<unknown>;
  // processes/<id>/process.yaml, parsed.
  processes(): Promise<readonly { readonly path: string; readonly process: unknown }[]>;
  pages(): Promise<readonly PageSource[]>;
  scenes(): Promise<readonly SceneSource[]>;
  // documentation/theme/: the client's theme.css and the images and fonts it uses, by path inside
  // the folder. Absent or empty: the site ships its template.
  theme?(): Promise<readonly ThemeFile[]>;
  // Sets evidence.<id>.hash in a page's front matter, keeping the rest of the file as written.
  pinHashes(path: string, hashes: ReadonlyMap<string, string>): Promise<void>;
}

// One record of a table as listed: its main fields only (no long-field files), and who changed
// it last.
export interface MirrorListing {
  readonly sysId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly updatedBy?: string;
  readonly updatedOn?: string;
}

// The instance's mirror, read only.
export interface MirrorRecords {
  read(table: string, sysId: string): Promise<MirrorRecord | null>;
  // Every record of a table, for the configuration index.
  list(table: string, signal: AbortSignal): Promise<readonly MirrorListing[]>;
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
  readonly video: VideoRenderer;
  readonly videos: VideoOutput;
}

export interface VideoOptions {
  readonly seconds: number;
  readonly fps: number;
  // Show the subtitles (narrated tracks).
  readonly subtitles: boolean;
}

// Plays an animation page in a headless browser and encodes it, with its audio track, as an
// H.264 MP4 (phase 3).
export interface VideoRenderer {
  available(): Promise<boolean>;
  render(
    page: string,
    audio: Uint8Array | null,
    options: VideoOptions,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  // A renderer that keeps recordings: after a build that recorded every animation, drop the ones
  // it didn't use. Returns how many were removed.
  prune?(signal: AbortSignal): Promise<number>;
}

// Where videos go: .snagentic/videos/<name>.mp4; returns the path written.
export interface VideoOutput {
  write(name: string, video: Uint8Array): Promise<string>;
}
