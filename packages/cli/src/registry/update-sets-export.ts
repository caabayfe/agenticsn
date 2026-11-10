import { isAbsolute, join } from "node:path";
import { ExportFileExistsError, exportUpdateSet, instancePaths, slug } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

export const updateSetsExport = defineUseCase({
  group: "update-sets",
  name: "export",
  description:
    'Write an update set as ServiceNow XML, the same format as its "Export to XML", to import ' +
    "on another instance by hand or to archive. Reads only; nothing is created on the instance.",
  input: z.object({
    instance: z.string(),
    id: z.string().describe("the update set's sys_id"),
    output: z
      .string()
      .optional()
      .describe(
        "file to write (default: .snagentic/<instance>/exports/<name>--<sys_id>.xml in the " +
          "workspace, which git ignores)",
      ),
  }),
  output: z.object({
    instance: z.string(),
    name: z.string(),
    updates: z.number(),
    path: z.string(),
    bytes: z.number(),
    withheld: z
      .array(z.object({ name: z.string(), target: z.string(), reason: z.string() }))
      .readonly()
      .describe("updates left out because they hold a secret; move them by hand"),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance", "id"],
  async handle(input, context, run) {
    const { root, name, profile, pager, reader } = await connect(
      context,
      input.instance,
      run.signal,
    );
    const deps = { pager, statistics: reader, now: context.clock };
    const exported = await exportUpdateSet(deps, name, input.id, profile.auth.username, run.signal);
    const path =
      input.output === undefined
        ? join(root, instancePaths(name).exports, `${slug(exported.name)}--${exported.sysId}.xml`)
        : isAbsolute(input.output)
          ? input.output
          : join(context.host.cwd, input.output);
    if ((await context.files.create(path, exported.xml)) === "exists") {
      throw new ExportFileExistsError(path);
    }
    return {
      instance: name,
      name: exported.name,
      updates: exported.updates,
      path,
      bytes: Buffer.byteLength(exported.xml),
      withheld: exported.withheld,
    };
  },
  render(output) {
    const done = `exported "${output.name}" (${output.updates} updates, ${output.bytes} bytes) to ${output.path}`;
    const withheld = output.withheld.map(
      (u) => `withheld ${u.name} (${u.target}): ${u.reason}; move it by hand`,
    );
    return [done, ...withheld].join("\n");
  },
  exitCode: () => 0,
});
