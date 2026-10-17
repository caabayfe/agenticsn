import { DocumentationSourceError } from "../domain/errors";
import { MediaToolMissingError } from "../domain/media-errors";
import { playerHtml } from "../domain/player";
import type { DocumentationSources, MediaTools } from "../ports";
import { audioTrack } from "./audio-tracks";
import { loadDocumentation } from "./load-documentation";

export interface RenderVideoDependencies {
  readonly sources: DocumentationSources;
  readonly media: MediaTools;
  readonly root: string;
  readonly signal: AbortSignal;
}

export interface RenderVideoQuery {
  readonly animation: string;
  // "none" for music and effects only.
  readonly voice: string;
  readonly fps: number;
}

export interface RenderVideoResult {
  readonly path: string;
  readonly seconds: number;
  readonly bytes: number;
}

// `docs video <animation>` (phase 3): the animation with its audio track as an MP4, for
// training material and places a web page can't go.
export async function renderVideo(
  deps: RenderVideoDependencies,
  query: RenderVideoQuery,
): Promise<RenderVideoResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const scene = docs.scenes.find((candidate) => candidate.name === query.animation);
  if (scene === undefined) {
    const known = docs.scenes.map((candidate) => candidate.name).join(", ") || "none";
    throw new DocumentationSourceError(
      `animations/${query.animation}`,
      `no such animation (known: ${known})`,
    );
  }
  if (!(await deps.media.video.available())) {
    throw new MediaToolMissingError(
      "a Chrome or Chromium browser",
      "install Google Chrome, or set SNAGENTIC_CHROME to its program",
    );
  }
  const track = await audioTrack(deps.media, scene, { voice: query.voice }, deps.signal);
  const video = await deps.media.video.render(
    playerHtml(scene, track.media),
    track.mp3,
    { seconds: track.media.timeline.total, fps: query.fps, subtitles: query.voice !== "none" },
    deps.signal,
  );
  const path = await deps.media.videos.write(scene.name, video);
  return { path, seconds: track.media.timeline.total, bytes: video.length };
}
