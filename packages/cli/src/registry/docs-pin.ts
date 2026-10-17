import { pinDocs } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Item = z.object({ page: z.string(), id: z.string(), anchor: z.string() });

export const docsPin = defineUseCase({
  group: "docs",
  name: "pin",
  description:
    "Record the mirror's current hash in the evidence of the documentation pages (all, or one page " +
    "by path or code). Run it only after re-verifying the claims the evidence supports. Lists " +
    "evidence whose record is gone: those claims must be rewritten.",
  input: z.object({ page: z.string().optional().describe("a page path or code (default: all)") }),
  output: z.object({ pinned: z.array(Item), missing: z.array(Item) }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["page"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const result = await pinDocs(
      { ...context.documentation(root), root, signal: run.signal },
      input.page === undefined ? {} : { page: input.page },
    );
    return { pinned: [...result.pinned], missing: [...result.missing] };
  },
  render(output) {
    return [
      `pinned ${output.pinned.length} evidence`,
      ...output.pinned.map((item) => `  ${item.page} ${item.id} ${item.anchor}`),
      ...(output.missing.length === 0
        ? []
        : [
            "gone from the mirror (rewrite these claims):",
            ...output.missing.map((item) => `  ${item.page} ${item.id} ${item.anchor}`),
          ]),
    ].join("\n");
  },
  exitCode: (output) => (output.missing.length === 0 ? 0 : 1),
});
