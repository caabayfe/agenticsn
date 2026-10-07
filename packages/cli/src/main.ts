// Composition root: the only place where adapters are wired to use cases.
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { INSTRUCTIONS, PROMPTS } from "@snagentic/agent-packs";
import { instancePaths } from "@snagentic/core";
import { EnvironmentCredentialStore } from "./adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "./adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "./adapters/credentials/layered-credential-store";
import { GhPullRequests } from "./adapters/delivery/gh-pull-requests";
import { GitDeliveryWorkspace } from "./adapters/delivery/git-delivery-workspace";
import { createTextFile } from "./adapters/fs/create-text-file";
import { fsWorkspaceFiles } from "./adapters/fs/fs-workspace-files";
import { gitInspector } from "./adapters/git/git-inspector";
import { gitIntegrator } from "./adapters/git/git-integrator";
import { gitInventoryReader } from "./adapters/git/git-inventory-reader";
import { GitMirror } from "./adapters/git/git-mirror";
import { gitProbe } from "./adapters/git-probe";
import { EslintScriptChecker } from "./adapters/governance/eslint-script-checker";
import { GitChangedRecords } from "./adapters/governance/git-changed-records";
import { keychainProbe } from "./adapters/keychain-probe";
import { GitMirrorFiles } from "./adapters/knowledge/git-mirror-files";
import { SqliteKnowledgeStore } from "./adapters/knowledge/sqlite-knowledge-store";
import { YamlProfileStore } from "./adapters/profiles/yaml-profile-store";
import { searchIndexProbe } from "./adapters/search-index-probe";
import { fetchTransport } from "./adapters/servicenow/fetch-transport";
import { SYSTEM_CLOCK } from "./adapters/servicenow/http-types";
import { RequestScheduler } from "./adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "./adapters/servicenow/servicenow-client";
import { JsonPushJournalStore } from "./adapters/state/json-push-journal-store";
import { JsonSyncStateStore } from "./adapters/state/json-sync-state-store";
import { TerminalSecretReader } from "./adapters/terminal/terminal-secret-reader";
import { FsWorkspaceStore } from "./adapters/workspace/fs-workspace-store";
import { runCli } from "./cli/run-cli";
import { createMcpServer } from "./mcp/create-mcp-server";
import { developmentInstances } from "./registry/development-instances";
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
  syncState: (root, instance) =>
    new JsonSyncStateStore(join(root, instancePaths(instance).localState)),
  mirrors: { open: (root, instance, mode) => GitMirror.open(root, instance, mode) },
  integrator: gitIntegrator,
  inspector: gitInspector,
  inventory: gitInventoryReader,
  knowledge: (root, instance) => {
    const paths = instancePaths(instance);
    return {
      store: new SqliteKnowledgeStore(join(root, paths.localState, "knowledge.sqlite")),
      files: new GitMirrorFiles(root, paths.metadata),
    };
  },
  governance: (root, instance) => ({
    records: new GitChangedRecords(root, instancePaths(instance).metadata),
    checker: new EslintScriptChecker(),
  }),
  files: { create: createTextFile },
  workspaceFiles: fsWorkspaceFiles,
  delivery: (root, instance) => new GitDeliveryWorkspace(root, instance),
  pullRequests: (root) => new GhPullRequests(root),
  pushJournal: (root, instance) =>
    new JsonPushJournalStore(join(root, instancePaths(instance).localState)),
  clock: () => new Date(),
  sleep: SYSTEM_CLOCK.sleep,
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
    readStdin: () => new Response(Bun.stdin.stream()).text(),
    serveMcp: async () => {
      const development = await developmentInstances(context);
      await createMcpServer(USE_CASES, context, versionLine(), development, {
        instructions: INSTRUCTIONS,
        prompts: PROMPTS,
      }).connect(new StdioServerTransport());
    },
  },
);
