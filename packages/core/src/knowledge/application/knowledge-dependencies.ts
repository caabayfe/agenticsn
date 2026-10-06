import type { CatalogData } from "../../metadata/domain/catalog";
import type { KnowledgeStore, MirrorFiles } from "../ports";

export interface KnowledgeDependencies {
  readonly store: KnowledgeStore;
  readonly files: MirrorFiles;
  readonly catalog: CatalogData | null;
  // Watermark of the last pull (raw UTC); null when never pulled.
  readonly asOf: string | null;
  readonly now: () => Date;
}

// Every knowledge result says how fresh the mirror behind it is (design 3.1, rule 4).
export interface Freshness {
  readonly asOf: string | null;
  readonly stale: boolean;
}

export interface NextCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, string | boolean>>;
}
