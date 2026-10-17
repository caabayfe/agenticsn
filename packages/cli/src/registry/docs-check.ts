import { checkDocs, DOCS_PROBLEM_KINDS } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const EvidenceResultSchema = z.object({
  page: z.string(),
  id: z.string(),
  anchor: z.string(),
  status: z.enum(["fresh", "changed", "missing", "unpinned", "seen", "recheck"]),
});

export const DocsProblemSchema = z.object({
  kind: z.enum(DOCS_PROBLEM_KINDS),
  severity: z.enum(["error", "warning"]),
  page: z.string(),
  detail: z.string(),
});

export function checkLines(check: {
  readonly evidence: readonly z.output<typeof EvidenceResultSchema>[];
  readonly problems: readonly z.output<typeof DocsProblemSchema>[];
}): string[] {
  return [
    ...check.evidence
      .filter((item) => item.status !== "fresh" && item.status !== "seen")
      .map((item) => `  ${item.status.padEnd(9)} ${item.page} ${item.id} ${item.anchor}`),
    ...check.problems.map(
      (problem) =>
        `  ${problem.severity === "error" ? "error  " : "warning"} ${problem.kind} ${problem.page} ${problem.detail}`,
    ),
  ];
}

export const docsCheck = defineUseCase({
  group: "docs",
  name: "check",
  description:
    "Check the workspace's documentation (documentation/) against the instance's mirror: evidence " +
    "whose record changed or is gone, citations of unknown evidence, missing animations, and the " +
    "sections: shared pages, end user and operator guides, configure pages. Exits 1 when a page " +
    "is no longer true or a source has an error. Reads only the mirror.",
  input: z.object({}),
  output: z.object({
    instance: z.string(),
    processes: z.number(),
    pages: z.number(),
    animations: z.number(),
    ok: z.boolean(),
    evidence: z.array(EvidenceResultSchema),
    problems: z.array(DocsProblemSchema),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(_input, context, run) {
    const root = await workspaceRoot(context);
    const docs = context.documentation(root);
    const check = await checkDocs({ ...docs, root, signal: run.signal, clock: context.clock });
    return {
      ...check,
      evidence: check.evidence.map(({ page, id, anchor, status }) => ({
        page,
        id,
        anchor,
        status,
      })),
      problems: [...check.problems],
    };
  },
  render(output) {
    const fresh = output.evidence.filter(
      (item) => item.status === "fresh" || item.status === "seen",
    ).length;
    const head =
      `${output.ok ? "documentation is up to date" : "documentation is out of date"}: ` +
      `${output.processes} processes, ${output.pages} pages, ${output.animations} animations, ${fresh}/${output.evidence.length} ` +
      `evidence fresh against ${output.instance}`;
    const lines = checkLines(output);
    const next = output.ok
      ? []
      : ["re-verify the claims, update the pages, then: snagentic docs pin"];
    return [head, ...lines, ...next].join("\n");
  },
  exitCode: (output) => (output.ok ? 0 : 1),
});
