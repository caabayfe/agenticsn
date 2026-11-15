import {
  CLAUDE_SETTINGS,
  CODEX_SERVERS,
  copilotHookFile,
  INSTRUCTIONS,
  LEGACY_SKILL_HASHES,
  MCP_CONFIGS,
  referenceFiles,
  skillFiles,
} from "@snagentic/agent-packs";
import {
  type AgentHost,
  installAgentPack,
  installUserSkills,
  migrateWorkspaceSkills,
  VERSION,
  withWorkspaceLock,
} from "@snagentic/core";
import type { UseCaseContext } from "./use-case";

export async function installAgentIntegration(
  context: UseCaseContext,
  root: string | null,
  hosts: readonly AgentHost[],
  scope: "user" | "workspace" = "user",
) {
  const destination = scope === "user" ? context.host.home : root;
  if (destination === null) return [];
  const files = context.agentFiles(destination);
  await files.guard(destination, `${destination}/.snagentic/workspace.lock`);
  const selected = [...skillFiles(VERSION), ...referenceFiles()].filter((file) =>
    file.hosts.some((host) => hosts.includes(host)),
  );
  const install = () => installUserSkills(files, destination, selected);
  const skills =
    destination === root
      ? await install()
      : await withWorkspaceLock(
          context.workspaceLock(destination, null),
          {
            instance: null,
            command: "agent install (user skills)",
            started: context.clock().toISOString(),
          },
          install,
        );
  if (root === null) return skills;
  const local = await installAgentPack(
    context.workspaceFiles,
    root,
    {
      version: VERSION,
      instructions: INSTRUCTIONS,
      files: [copilotHookFile()],
      claudeSettings: CLAUDE_SETTINGS,
      mcpConfigs: MCP_CONFIGS,
      codexServers: CODEX_SERVERS,
    },
    hosts,
    context.parseToml,
  );
  const available = new Set(
    selected
      .filter((file) =>
        skills.some(
          (result) => result.path === `${destination}/${file.path}` && result.status !== "skipped",
        ),
      )
      .map((file) => file.path),
  );
  const migrated =
    scope === "user"
      ? await migrateWorkspaceSkills(context.agentFiles(root), root, LEGACY_SKILL_HASHES, available)
      : [];
  return [...skills, ...local, ...migrated];
}
