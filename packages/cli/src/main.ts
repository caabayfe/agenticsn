// Composition root: the only place where adapters are wired to use cases.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { gitProbe } from "./adapters/git-probe";
import { keychainProbe } from "./adapters/keychain-probe";
import { searchIndexProbe } from "./adapters/search-index-probe";
import { runCli } from "./cli/run-cli";
import { createMcpServer } from "./mcp/create-mcp-server";
import { USE_CASES } from "./registry/registry";
import type { UseCaseContext } from "./registry/use-case";
import { versionLine } from "./version-line";

// First Ctrl-C cancels the running operation cleanly; a second one exits immediately.
const cancellation = new AbortController();
process.on("SIGINT", () => {
  if (cancellation.signal.aborted) {
    process.exit(130);
  }
  cancellation.abort();
});

const context: UseCaseContext = {
  environmentProbes: [gitProbe(), keychainProbe(), searchIndexProbe()],
};

process.exitCode = await runCli(
  process.argv.slice(2),
  USE_CASES,
  context,
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  {
    version: versionLine(),
    signal: cancellation.signal,
    serveMcp: async () => {
      await createMcpServer(USE_CASES, context, versionLine()).connect(new StdioServerTransport());
    },
  },
);
