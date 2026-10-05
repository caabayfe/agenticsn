// Composition root: the only place where adapters are wired to use cases.
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EnvironmentCredentialStore } from "./adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "./adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "./adapters/credentials/layered-credential-store";
import { gitProbe } from "./adapters/git-probe";
import { keychainProbe } from "./adapters/keychain-probe";
import { YamlProfileStore } from "./adapters/profiles/yaml-profile-store";
import { searchIndexProbe } from "./adapters/search-index-probe";
import { fetchTransport } from "./adapters/servicenow/fetch-transport";
import { RequestScheduler } from "./adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "./adapters/servicenow/servicenow-client";
import { TerminalSecretReader } from "./adapters/terminal/terminal-secret-reader";
import { FsWorkspaceStore } from "./adapters/workspace/fs-workspace-store";
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

const workspaceOverride = process.env["SNAGENTIC_WORKSPACE"];
const context: UseCaseContext = {
  environmentProbes: [gitProbe(), keychainProbe(), searchIndexProbe()],
  workspaces: new FsWorkspaceStore(),
  profiles: new YamlProfileStore(),
  credentials: new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
  secrets: new TerminalSecretReader(),
  connections: {
    open: (profile, secret) =>
      new ServiceNowClient(profile, secret, new RequestScheduler(fetchTransport()), versionLine()),
  },
  host: {
    cwd: process.cwd(),
    home: homedir(),
    version: versionLine(),
    ...(workspaceOverride === undefined ? {} : { workspaceOverride }),
  },
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
