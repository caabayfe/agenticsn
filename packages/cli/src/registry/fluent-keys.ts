import { fluentSourcePath, writeFluentKeys } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const fluentKeys = defineUseCase({
  help: {
    summary: "Generate stable Fluent record IDs",
    section: "Develop",
    visibility: "internal",
    details:
      "Write generated keys.ts files for projects whose build adds IDs. Commit these files " +
      "with the source. The pre-commit hook uses --staged to build the index and stage the " +
      "generated keys.",
    effects:
      "Writes generated keys.ts files; --staged also stages them. Does not call the instance.",
    examples: [["fluent-keys"], ["fluent-keys", "--staged"]],
  },
  name: "fluent-keys",
  description:
    "Write src/fluent/generated/keys.ts for the Fluent projects under source/ whose build adds " +
    "IDs: each new Now.ID gets its sys_id once, and keys.ts is committed with the source so " +
    "every later build names the record the same (rule SN-MNT-010). The pre-commit hook runs " +
    "it with --staged, which builds what is staged and stages keys.ts. Writes no other file " +
    "and calls no instance.",
  input: z.object({
    paths: z
      .array(z.string())
      .optional()
      .describe("project folders or files in them (default: every project changed since HEAD)"),
    staged: z
      .boolean()
      .default(false)
      .describe(
        "build the projects as the index holds them and stage keys.ts (the pre-commit hook)",
      ),
  }),
  output: z.object({
    projects: z.number(),
    written: z
      .array(z.object({ path: z.string(), added: z.array(z.string()).readonly() }))
      .readonly(),
    notBuilt: z.array(z.string()).readonly().describe("projects with build errors: run validate"),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["paths"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const paths = input.paths?.map((p) => fluentSourcePath(root, p) ?? p);
    return writeFluentKeys(context.fluentProjects(root, { staged: input.staged }), paths);
  },
  render(output) {
    const lines = [
      ...output.written.map(
        (w) => `${w.path}: keys.ts gains ${w.added.length > 0 ? w.added.join(", ") : "new IDs"}`,
      ),
      ...output.notBuilt.map((p) => `${p}: does not build, keys not written (snagentic validate)`),
    ];
    return lines.length > 0 ? lines.join("\n") : "";
  },
  // Build errors are validate's to report; the hook runs it next.
  exitCode: () => 0,
});
