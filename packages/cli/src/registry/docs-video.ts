import { renderVideo } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { HELP_GROUPS } from "./use-case-help";
import { workspaceRoot } from "./workspace-root";

export const docsVideo = defineUseCase({
  help: {
    summary: "Record a documentation animation as MP4",
    section: "Additional workflows",
    group: HELP_GROUPS.docs,
    details:
      "Record an animation in headless Chrome with ffmpeg. Optional narration uses piper or " +
      "the system voice. Recording runs in real time and takes as long as the animation.",
    effects:
      "Writes a local MP4 and generated media under .snagentic/; does not call the instance.",
    examples: [["docs", "video", "overview"]],
  },
  group: "docs",
  name: "video",
  description:
    "Record one documentation animation as an MP4 video (H.264, with music and sound effects, " +
    "and narration with --voice piper|system), in .snagentic/videos/<animation>.mp4. Plays the " +
    "animation in a headless Chrome in real time, so it takes as long as the animation.",
  input: z.object({
    animation: z.string().describe("the animation's name (documentation/animations/<name>)"),
    voice: z.string().default("none").describe("narrate with piper, system, or none"),
    fps: z.number().int().min(10).max(60).default(30).describe("frames per second"),
  }),
  output: z.object({ path: z.string(), seconds: z.number(), bytes: z.number() }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["animation"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const docs = context.documentation(root);
    run.progress({ message: `recording ${input.animation} in real time…` });
    return renderVideo({ ...docs, root, signal: run.signal }, input);
  },
  render: (output) =>
    `wrote ${output.path} (${output.seconds.toFixed(1)} s, ${Math.round(output.bytes / 1024)} KB)`,
  exitCode: () => 0,
});
