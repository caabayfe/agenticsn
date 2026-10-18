import { documentationImpact, READERS } from "@snagentic/core";
import { z } from "zod";
import { instanceFor } from "./knowledge-session";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Claim = z.object({ heading: z.string(), reader: z.enum(READERS), text: z.string() });

const Item = z.object({
  page: z.string(),
  title: z.string(),
  record: z.string(),
  evidence: z.array(z.string()).readonly(),
  cause: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("source"), files: z.array(z.string()).readonly() }),
    z.object({ kind: z.literal("instance"), status: z.enum(["changed", "missing"]) }),
  ]),
  claims: z.array(Claim).readonly(),
});

type ImpactOutput = {
  readonly base: string;
  readonly units: number;
  readonly items: readonly z.output<typeof Item>[];
};

const HEADINGS: Readonly<Record<(typeof READERS)[number], string>> = {
  employees: "Employees",
  everyone: "Employees and operators",
  operators: "Operators",
  platform: "Platform team",
};

function causeText(item: z.output<typeof Item>): string {
  const evidence = `${item.evidence.join(", ")} \`${item.record}\``;
  return item.cause.kind === "source"
    ? `${evidence}, changed by ${item.cause.files.map((file) => `\`${file}\``).join(", ")}`
    : `${evidence}, ${item.cause.status === "missing" ? "gone from" : "changed on"} the instance since the page was checked`;
}

// Markdown, so CI can post it on the pull request as it is.
export function impactMarkdown(output: ImpactOutput): string {
  if (output.items.length === 0) {
    return `No documentation is affected by the changes since ${output.base}.`;
  }
  const claims = output.items.flatMap((item) => item.claims.map((claim) => ({ item, claim })));
  const pages = new Set(output.items.map((item) => item.page)).size;
  const sections = READERS.flatMap((reader) => {
    const mine = claims.filter(({ claim }) => claim.reader === reader);
    return mine.length === 0
      ? []
      : [
          `### ${HEADINGS[reader]}`,
          "",
          ...mine.flatMap(({ item, claim }) => [
            `- [${item.title}](${item.page}) › ${claim.heading}: "${claim.text}"`,
            `  ${causeText(item)}`,
          ]),
          "",
        ];
  });
  return [
    "## Documentation impact",
    "",
    `${claims.length} claim(s) on ${pages} page(s) may no longer be true, from source changed since ${output.base} and from changes on the instance.`,
    "",
    ...sections,
    "Fix each page in the same change: check the claim against the change, correct it, then " +
      "run `snagentic docs pin` on the page.",
  ].join("\n");
}

export const docsImpact = defineUseCase({
  group: "docs",
  name: "impact",
  description:
    "What a change does to the workspace's documentation: each claim (sentence, list item or " +
    "table row) whose evidence the change affects, with its page, heading and reader (employees, " +
    "operators, platform team). Covers the Fluent source changed since base, evidence on a field " +
    "only when that field changes, and evidence the instance changed since the page was " +
    "verified. The text is Markdown, to post on a pull request. Read the JSON to fix the pages in " +
    "the same change. Reads only the workspace and the mirror.",
  input: z.object({
    base: z
      .string()
      .default("HEAD")
      .describe("commit, branch or tag to compare with, for example origin/main"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
  }),
  output: z.object({
    instance: z.string(),
    base: z.string(),
    units: z.number().describe("units the change adds or edits"),
    items: z.array(Item).readonly(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const instance = await instanceFor(root, context, input.instance);
    run.progress({ message: "building the changed source and reading the documentation" });
    const impact = await documentationImpact(context.governance(root, instance), {
      base: input.base,
      signal: run.signal,
    });
    return { instance, ...impact };
  },
  render: (output) => impactMarkdown(output),
  exitCode: () => 0,
});
