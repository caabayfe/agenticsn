import { z } from "zod";
import { AudioInput, docsBuild } from "./docs-build";
import { runUseCase } from "./execute";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const DEFAULT_PORT = 4173;

export const docsServe = defineUseCase({
  group: "docs",
  name: "serve",
  description:
    "Build the documentation site and serve it on http://127.0.0.1:<port>/ for preview, until " +
    "stopped with Ctrl-C. Local only; publishing is copying .snagentic/site/ to a web server.",
  input: z.object({
    ...AudioInput,
    port: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .optional()
      .describe(`the port (default ${DEFAULT_PORT})`),
  }),
  output: z.object({ url: z.string(), files: z.number() }),
  flags: {
    readOnly: false,
    destructive: false,
    requiresDevelopmentInstance: false,
    // Serving writes nothing: the build runs as docs build, under the workspace's lock, which is
    // given back before serving, so a preview left running blocks no other command.
    lock: "none",
  },
  mcp: false,
  async handle(input, context, run) {
    const { audio, voice, video } = input;
    const built = await runUseCase(docsBuild, { audio, voice, video }, context, run);
    const docs = context.documentation(await workspaceRoot(context));
    let url = "";
    await docs.serve(input.port ?? DEFAULT_PORT, run.signal, (address) => {
      url = address;
      run.progress({ message: `serving ${built.files} files at ${address} (Ctrl-C to stop)` });
    });
    return { url, files: built.files };
  },
  render: (output) => `stopped serving ${output.url}`,
  exitCode: () => 0,
});
