import { isAbsolute, join } from "node:path";
import { exportUpdateSet, slug } from "@snagentic/core";
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
    output: z.string().optional().describe("file to write (default: <name>--<sys_id>.xml here)"),
  }),
  output: z.object({
    instance: z.string(),
    name: z.string(),
    updates: z.number(),
    path: z.string(),
    bytes: z.number(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance", "id"],
  async handle(input, context, run) {
    const { name, profile, pager, reader } = await connect(context, input.instance, run.signal);
    const deps = { pager, statistics: reader, now: context.clock };
    const exported = await exportUpdateSet(deps, name, input.id, profile.auth.username, run.signal);
    const file = input.output ?? `${slug(exported.name)}--${exported.sysId}.xml`;
    const path = isAbsolute(file) ? file : join(context.host.cwd, file);
    await context.files.write(path, exported.xml);
    return {
      instance: name,
      name: exported.name,
      updates: exported.updates,
      path,
      bytes: Buffer.byteLength(exported.xml),
    };
  },
  render(output) {
    return `exported "${output.name}" (${output.updates} updates, ${output.bytes} bytes) to ${output.path}`;
  },
  exitCode: () => 0,
});
