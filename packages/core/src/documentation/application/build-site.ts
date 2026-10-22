import type { ConfigIndex } from "../domain/config-index";
import type { EvidenceStatus } from "../domain/evidence";
import { type PlayerMedia, playerHtml } from "../domain/player";
import type { Scene } from "../domain/scene";
import { siteFiles } from "../domain/site";
import type { SiteMedia } from "../domain/site-config";
import type { MarkdownRenderer, MediaTools, MirrorRecords, SiteOutput } from "../ports";
import { type AudioOptions, audioTrack } from "./audio-tracks";
import {
  assessDocumentation,
  type CheckDocsDependencies,
  type DocsCheck,
  todayOf,
} from "./check-docs";
import { configIndex } from "./config-index";
import { type Documentation, loadDocumentation } from "./load-documentation";

export interface BuildSiteDependencies extends CheckDocsDependencies {
  readonly markdown: MarkdownRenderer;
  readonly output: SiteOutput;
  readonly media: MediaTools;
  // The address of the instance named in site.yaml, from the workspace's profiles; null when the
  // workspace has no profile for it, and the records are then named without links.
  readonly instanceUrl?: (instance: string) => Promise<string | null>;
}

export interface BuildSiteOptions {
  // Give each animation an audio track (music and effects, and the voice when asked).
  readonly audio?: AudioOptions;
  // Also render each animation as an MP4 with its track (spec 010c); implies audio.
  readonly video?: { readonly fps: number };
}

export interface BuildSiteResult {
  readonly root: string;
  readonly files: number;
  readonly check: DocsCheck;
  // Animations given an audio track, and cue sounds that were missing from them.
  readonly narrated: readonly string[];
  // The voice the tracks were narrated with, "none" for music and effects only.
  readonly voice: string;
  readonly missingSounds: readonly string[];
  // Animations rendered as video, and why the others couldn't be.
  readonly videos: readonly string[];
  readonly videosNotMade: readonly { readonly animation: string; readonly reason: string }[];
  // Old recordings removed from the video cache.
  readonly videosPruned: number;
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

// Each animation as an MP4 with its track; a missing browser is reported per animation, never
// silently skipped.
async function renderVideos(
  deps: BuildSiteDependencies,
  scenes: readonly Scene[],
  media: ReadonlyMap<string, { readonly player: PlayerMedia; readonly mp3: Uint8Array }>,
  audio: AudioOptions | undefined,
  video: BuildSiteOptions["video"],
) {
  const videos = new Map<string, Uint8Array>();
  const notMade: { animation: string; reason: string }[] = [];
  if (video === undefined) return { videos, notMade, pruned: 0 };
  const browser = await deps.media.video.available();
  for (const scene of scenes) {
    const track = media.get(scene.name);
    if (!browser || track === undefined) {
      notMade.push({ animation: scene.name, reason: "no Chrome or Chromium browser" });
      continue;
    }
    const options = {
      seconds: track.player.timeline.total,
      fps: video.fps,
      subtitles: (audio?.voice ?? "none") !== "none",
    };
    videos.set(
      scene.name,
      await deps.media.video.render(
        playerHtml(scene, track.player),
        track.mp3,
        options,
        deps.signal,
      ),
    );
  }
  const pruned = browser ? ((await deps.media.video.prune?.(deps.signal)) ?? 0) : 0;
  return { videos, notMade, pruned };
}

// Media as people ask for it, on the command line or in site.yaml: a voice or a video implies
// an audio track.
export interface MediaRequest {
  readonly audio?: boolean | undefined;
  readonly voice?: string | undefined;
  readonly video?: boolean | undefined;
}

export function mediaOptions(request: MediaRequest): BuildSiteOptions {
  const voice = request.voice ?? "none";
  const narrated = request.audio === true || voice !== "none" || request.video === true;
  return {
    ...(narrated ? { audio: { voice } } : {}),
    ...(request.video === true ? { video: { fps: 30 } } : {}),
  };
}

const fromSite = (media: SiteMedia | undefined): BuildSiteOptions =>
  media === undefined ? {} : mediaOptions(media);

// Command-line flags: each replaces only its own setting in site.yaml, so `--video` alone keeps
// the voice site.yaml asks for.
export interface MediaFlags {
  readonly flags: MediaRequest;
}

export const mediaWith = (flags: MediaRequest, site: SiteMedia | undefined): BuildSiteOptions =>
  mediaOptions({
    audio: flags.audio ?? site?.audio,
    voice: flags.voice ?? site?.voice,
    video: flags.video ?? site?.video,
  });

function optionsOf(
  given: BuildSiteOptions | MediaFlags | undefined,
  site: SiteMedia | undefined,
): BuildSiteOptions {
  if (given === undefined) return fromSite(site);
  return "flags" in given ? mediaWith(given.flags, site) : given;
}

async function indexesOf(
  docs: Documentation,
  mirror: MirrorRecords,
  check: DocsCheck,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, ConfigIndex>> {
  const indexes = new Map<string, ConfigIndex>();
  for (const process of docs.processes) {
    indexes.set(process.id, await configIndex(docs, process, mirror, check, signal));
  }
  return indexes;
}

// `docs build`: the static site, with each page's evidence status as of now. A stale page is
// built and says so; `docs check` is the gate. Without options it makes the media site.yaml asks
// for; with flags, site.yaml with the flags over it.
export async function buildSite(
  deps: BuildSiteDependencies,
  given?: BuildSiteOptions | MediaFlags,
): Promise<BuildSiteResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const options = optionsOf(given, docs.config.media);
  const mirror = deps.mirror(docs.config.instance);
  const check = await assessDocumentation(docs, mirror, todayOf(deps.clock), deps.signal);
  const media = new Map<string, { readonly player: PlayerMedia; readonly mp3: Uint8Array }>();
  const missing = new Set<string>();
  const audio = options.audio ?? (options.video === undefined ? undefined : { voice: "none" });
  if (audio !== undefined) {
    for (const scene of docs.scenes) {
      const track = await audioTrack(deps.media, scene, audio, deps.signal);
      media.set(scene.name, { player: track.media, mp3: track.mp3 });
      for (const name of track.missingSounds) {
        missing.add(name);
      }
    }
  }
  const { videos, notMade, pruned } = await renderVideos(
    deps,
    docs.scenes,
    media,
    audio,
    options.video,
  );
  const indexes = await indexesOf(docs, mirror, check, deps.signal);
  const instanceUrl = (await deps.instanceUrl?.(docs.config.instance)) ?? null;
  const files = siteFiles({
    config: docs.config,
    processes: docs.processes,
    pages: docs.pages,
    scenes: docs.scenes,
    statuses: statusesByPage(check),
    markdown: (source) => deps.markdown.html(source),
    builtAt: todayOf(deps.clock),
    mirrorCommit: await mirror.head(),
    media,
    indexes,
    videos,
    theme: (await deps.sources.theme?.()) ?? [],
    releases: docs.releases,
    features: docs.features,
    questions: docs.questions,
    ...(instanceUrl === null ? {} : { instanceUrl }),
  });
  await deps.output.replace(files);
  return {
    root: deps.output.root,
    files: files.length,
    check,
    narrated: [...media.keys()],
    voice: audio?.voice ?? "none",
    missingSounds: [...missing],
    videos: [...videos.keys()],
    videosNotMade: notMade,
    videosPruned: pruned,
  };
}
