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
  replace(files: readonly { readonly path: string; readonly content: string }[]): Promise<void>;
}
