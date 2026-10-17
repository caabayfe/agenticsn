import { buildSite } from "@snagentic/core";
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
});

export async function buildDocs(context: UseCaseContext, signal: AbortSignal) {
  const root = await workspaceRoot(context);
  const docs = context.documentation(root);
  const built = await buildSite({ ...docs, root, signal, clock: context.clock });
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
  };
}

export const docsBuild = defineUseCase({
  group: "docs",
  name: "build",
  description:
    "Build the documentation as a static site (HTML, CSS, self-contained animations) in " +
    ".snagentic/site/, for any web server. Each page shows its evidence status against the mirror; " +
    "a stale page is built and says so (docs check is the gate).",
  input: z.object({}),
  output: DocsBuildOutput,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  handle: (_input, context, run) => buildDocs(context, run.signal),
  render(output) {
    const state = output.ok ? "" : " (some pages are out of date)";
    return [`built ${output.files} files in ${output.root}${state}`, ...checkLines(output)].join(
      "\n",
    );
  },
  exitCode: () => 0,
});
