import { buildSite, type MediaRequest } from "@snagentic/core";
import { z } from "zod";
import { checkLines, DocsProblemSchema, EvidenceResultSchema } from "./docs-check";
import { defineUseCase, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const DocsBuildOutput = z.object({
  root: z.string(),
  files: z.number(),
  ok: z.boolean(),
  evidence: z.array(EvidenceResultSchema),
  problems: z.array(DocsProblemSchema),
  narrated: z.array(z.string()),
  voice: z.string(),
  missingSounds: z.array(z.string()),
  videos: z.array(z.string()),
  videosNotMade: z.array(z.object({ animation: z.string(), reason: z.string() })),
  videosPruned: z.number(),
});

export const AudioInput = {
  audio: z
    .boolean()
    .optional()
    .describe("give each animation an audio track: music and sound effects (needs ffmpeg)"),
  voice: z
    .string()
    .optional()
    .describe("narrate the steps with a voice: piper, system or none (implies --audio)"),
  video: z
    .boolean()
    .optional()
    .describe("also render every animation as an MP4 on its page (needs ffmpeg and Chrome)"),
};

export async function buildDocs(
  context: UseCaseContext,
  signal: AbortSignal,
  input: MediaRequest = {},
) {
  const root = await workspaceRoot(context);
  const docs = context.documentation(root);
  const built = await buildSite({ ...docs, root, signal, clock: context.clock }, { flags: input });
  return {
    root: built.root,
    files: built.files,
    ok: built.check.ok,
    evidence: built.check.evidence.map(({ page, id, anchor, status }) => ({
      page,
      id,
      anchor,
      status,
    })),
    problems: [...built.check.problems],
    narrated: [...built.narrated],
    voice: built.voice,
    missingSounds: [...built.missingSounds],
    videos: [...built.videos],
    videosNotMade: built.videosNotMade.map((item) => ({ ...item })),
    videosPruned: built.videosPruned,
  };
}

export const docsBuild = defineUseCase({
  group: "docs",
  name: "build",
  description:
    "Build the documentation as a static site (HTML, CSS, self-contained animations) in " +
    ".snagentic/site/, for any web server. Each page shows its evidence status against the mirror; " +
    "a stale page is built and says so (docs check is the gate). --audio adds music and sound " +
    "effects to the animations, --voice piper|system also narrates them, --video renders every " +
    "animation as an MP4 on its page and names any it could not make. It makes the media site.yaml " +
    "asks for (media: audio, voice, video), each flag replacing only its own setting (--voice none " +
    "for no narration); recorded videos are reused until their animation changes.",
  input: z.object(AudioInput),
  output: DocsBuildOutput,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  handle: (input, context, run) => buildDocs(context, run.signal, input),
  render(output) {
    const state = output.ok ? "" : " (some pages are out of date)";
    const audio =
      output.narrated.length === 0
        ? []
        : [
            `audio tracks (${output.voice === "none" ? "no voice: music and effects only" : `voice ${output.voice}`}): ${output.narrated.join(", ")}`,
          ];
    const missing =
      output.missingSounds.length === 0
        ? []
        : [`cue sounds not found (left out): ${output.missingSounds.join(", ")}`];
    const videos = output.videos.length === 0 ? [] : [`videos: ${output.videos.join(", ")}`];
    const notMade = output.videosNotMade.map(
      (item) => `video not made: ${item.animation} (${item.reason})`,
    );
    return [
      `built ${output.files} files in ${output.root}${state}`,
      ...audio,
      ...videos,
      ...notMade,
      ...(output.videosPruned === 0
        ? []
        : [`removed ${output.videosPruned} old recordings from the video cache`]),
      ...missing,
      ...checkLines(output),
    ].join("\n");
  },
  exitCode: () => 0,
});
