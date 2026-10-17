import type { EvidenceStatus } from "../domain/evidence";
import type { PlayerMedia } from "../domain/player";
import { siteFiles } from "../domain/site";
import type { MarkdownRenderer, MediaTools, SiteOutput } from "../ports";
import { type AudioOptions, audioTrack } from "./audio-tracks";
import { assessDocumentation, type CheckDocsDependencies, type DocsCheck } from "./check-docs";
import { loadDocumentation } from "./load-documentation";

export interface BuildSiteDependencies extends CheckDocsDependencies {
  readonly markdown: MarkdownRenderer;
  readonly output: SiteOutput;
  readonly clock: () => Date;
  readonly media: MediaTools;
}

export interface BuildSiteOptions {
  // Give each animation an audio track (music and effects, and the voice when asked).
  readonly audio?: AudioOptions;
}

export interface BuildSiteResult {
  readonly root: string;
  readonly files: number;
  readonly check: DocsCheck;
  // Animations given an audio track, and cue sounds that were missing from them.
  readonly narrated: readonly string[];
  readonly missingSounds: readonly string[];
}

function statusesByPage(check: DocsCheck): Map<string, Map<string, EvidenceStatus>> {
  const byPage = new Map<string, Map<string, EvidenceStatus>>();
  for (const item of check.evidence) {
    const page = byPage.get(item.page) ?? new Map<string, EvidenceStatus>();
    page.set(item.id, item.status);
    byPage.set(item.page, page);
  }
  return byPage;
}

// `docs build`: the static site, with each page's evidence status as of now. A stale page is
// built and says so; `docs check` is the gate.
export async function buildSite(
  deps: BuildSiteDependencies,
  options: BuildSiteOptions = {},
): Promise<BuildSiteResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const mirror = deps.mirror(docs.config.instance);
  const check = await assessDocumentation(docs, mirror, deps.signal);
  const media = new Map<string, { readonly player: PlayerMedia; readonly mp3: Uint8Array }>();
  const missing = new Set<string>();
  if (options.audio !== undefined) {
    for (const scene of docs.scenes) {
      const track = await audioTrack(deps.media, scene, options.audio, deps.signal);
      media.set(scene.name, { player: track.media, mp3: track.mp3 });
      for (const name of track.missingSounds) {
        missing.add(name);
      }
    }
  }
  const files = siteFiles({
    config: docs.config,
    processes: docs.processes,
    pages: docs.pages,
    scenes: docs.scenes,
    statuses: statusesByPage(check),
    markdown: (source) => deps.markdown.html(source),
    builtAt: deps.clock().toISOString().slice(0, 10),
    mirrorCommit: await mirror.head(),
    media,
  });
  await deps.output.replace(files);
  return {
    root: deps.output.root,
    files: files.length,
    check,
    narrated: [...media.keys()],
    missingSounds: [...missing],
  };
}
