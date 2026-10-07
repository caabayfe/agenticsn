import { describe, expect, it } from "bun:test";
import {
  type AgentPack,
  installAgentPack,
  installedPackVersion,
  type WorkspaceFiles,
  withAgentsImport,
  withClaudeSettings,
  withInstructions,
  withMcpServer,
} from "@snagentic/core";

const BLOCK = "# ServiceNow workspace\nrules";

describe("the instructions block in AGENTS.md", () => {
  it("creates the file with the block between markers that carry the version", () => {
    expect(withInstructions(null, BLOCK, "1.1.0")).toBe(
      `<!-- snagentic:begin 1.1.0 -->\n${BLOCK}\n<!-- snagentic:end -->\n`,
    );
  });

  it("appends the block to the team's own instructions, keeping them", () => {
    expect(withInstructions("# Our team\nUse tabs.\n\n", BLOCK, "1.1.0")).toBe(
      `# Our team\nUse tabs.\n\n<!-- snagentic:begin 1.1.0 -->\n${BLOCK}\n<!-- snagentic:end -->\n`,
    );
  });

  it("replaces only its own block on upgrade, wherever it is", () => {
    const old = withInstructions("# Ours\n", "old rules", "1.0.0");
    const upgraded = withInstructions(`${old}\n## After\nmore of ours\n`, BLOCK, "1.1.0");
    expect(upgraded).toBe(
      `# Ours\n\n<!-- snagentic:begin 1.1.0 -->\n${BLOCK}\n<!-- snagentic:end -->\n\n## After\nmore of ours\n`,
    );
    expect(installedPackVersion(upgraded)).toBe("1.1.0");
  });

  it("knows no version when the block was never installed", () => {
    expect(installedPackVersion(null)).toBeNull();
    expect(installedPackVersion("# Ours\n")).toBeNull();
  });
});

describe("the AGENTS.md import in CLAUDE.md", () => {
  it("creates CLAUDE.md importing AGENTS.md, or adds the import, once", () => {
    expect(withAgentsImport(null)).toBe("@AGENTS.md\n");
    expect(withAgentsImport("# Claude notes")).toBe("# Claude notes\n\n@AGENTS.md\n");
    expect(withAgentsImport("@AGENTS.md\n# notes\n")).toBe("@AGENTS.md\n# notes\n");
  });
});

function memoryFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const executables: string[] = [];
  const port: WorkspaceFiles = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content, options) => {
      writes.push(path);
      files.set(path, content);
      if (options?.executable === true) {
        executables.push(path);
      }
    },
  };
  return { port, files, writes, executables };
}

const SETTINGS = {
  hooks: { Stop: [{ hooks: [{ type: "command", command: "snagentic hook claude stop" }] }] },
  permissions: { deny: ["Bash(curl:*)"] },
};

const PACK: AgentPack = {
  version: "1.1.0",
  instructions: BLOCK,
  files: [{ path: ".agents/skills/servicenow-explain/SKILL.md", content: "skill" }],
  claudeSettings: SETTINGS,
  mcpConfigs: [
    { path: ".mcp.json", key: "mcpServers", server: { command: "snagentic", args: ["mcp"] } },
  ],
};

describe("installAgentPack", () => {
  it("writes the skills, the instructions block and the CLAUDE.md import", async () => {
    const { port, files } = memoryFiles({ "/w/CLAUDE.md": "# notes\n" });
    expect(await installAgentPack(port, "/w", PACK)).toEqual([
      { path: ".agents/skills/servicenow-explain/SKILL.md", status: "created" },
      { path: "AGENTS.md", status: "created" },
      { path: "CLAUDE.md", status: "updated" },
      { path: ".claude/settings.json", status: "created" },
      { path: ".mcp.json", status: "created" },
      { path: ".git/hooks/pre-commit", status: "created" },
    ]);
    expect(files.get("/w/AGENTS.md")).toContain("<!-- snagentic:begin 1.1.0 -->");
  });

  it("installs an executable pre-commit hook that validates, never replacing the team's own", async () => {
    const fresh = memoryFiles();
    await installAgentPack(fresh.port, "/w", PACK);
    expect(fresh.executables).toEqual(["/w/.git/hooks/pre-commit"]);
    expect(fresh.files.get("/w/.git/hooks/pre-commit")).toContain("snagentic validate");
    const theirs = memoryFiles({ "/w/.git/hooks/pre-commit": "#!/bin/sh\nnpm test\n" });
    const results = await installAgentPack(theirs.port, "/w", PACK);
    expect(results.at(-1)).toEqual({ path: ".git/hooks/pre-commit", status: "skipped" });
    expect(theirs.files.get("/w/.git/hooks/pre-commit")).toBe("#!/bin/sh\nnpm test\n");
  });

  it("writes nothing when the pack is already installed", async () => {
    const { port, writes } = memoryFiles();
    await installAgentPack(port, "/w", PACK);
    writes.length = 0;
    const second = await installAgentPack(port, "/w", PACK);
    expect(second.map((file) => file.status)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(writes).toEqual([]);
  });
});

describe("Claude Code settings", () => {
  it("adds our hooks and rules to the team's settings, keeping theirs", () => {
    const theirs = JSON.stringify({
      model: "opus",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./notify.sh" }] }] },
      permissions: { deny: ["Bash(rm:*)", "Bash(curl:*)"], allow: ["Read"] },
    });
    expect(JSON.parse(withClaudeSettings(theirs, SETTINGS) ?? "")).toEqual({
      model: "opus",
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "./notify.sh" }] },
          { hooks: [{ type: "command", command: "snagentic hook claude stop" }] },
        ],
      },
      permissions: { deny: ["Bash(rm:*)", "Bash(curl:*)"], allow: ["Read"] },
    });
  });

  it("replaces its own hook entries instead of adding them again", () => {
    const once = withClaudeSettings(null, SETTINGS);
    expect(withClaudeSettings(once, SETTINGS)).toBe(once);
  });

  it("leaves a settings file it cannot read as it is", () => {
    expect(withClaudeSettings("{ not json", SETTINGS)).toBeNull();
    expect(withClaudeSettings("[]", SETTINGS)).toBeNull();
  });

  it("reports the settings it could not merge", async () => {
    const { port } = memoryFiles({ "/w/.claude/settings.json": "{ broken" });
    const results = await installAgentPack(port, "/w", PACK);
    expect(results).toContainEqual({ path: ".claude/settings.json", status: "skipped" });
  });
});

describe("MCP server registration", () => {
  const SERVER = { command: "snagentic", args: ["mcp"] };

  it("registers the snagentic server so hosts start it without a manual step", () => {
    expect(JSON.parse(withMcpServer(null, "mcpServers", SERVER) ?? "")).toEqual({
      mcpServers: { snagentic: SERVER },
    });
  });

  it("adds it beside the team's other servers and settings, keeping them", () => {
    const theirs = JSON.stringify({ inputs: [], servers: { github: { url: "https://x" } } });
    expect(JSON.parse(withMcpServer(theirs, "servers", SERVER) ?? "")).toEqual({
      inputs: [],
      servers: { github: { url: "https://x" }, snagentic: SERVER },
    });
  });

  it("keeps a snagentic entry the team already configured, such as a binary path", () => {
    const theirs = `${JSON.stringify({ mcpServers: { snagentic: { command: "/opt/snagentic" } } }, null, 2)}\n`;
    expect(withMcpServer(theirs, "mcpServers", SERVER)).toBe(theirs);
  });

  it("leaves a config file it cannot read as it is", () => {
    expect(withMcpServer("{ not json", "mcpServers", SERVER)).toBeNull();
    expect(withMcpServer(JSON.stringify({ mcpServers: [] }), "mcpServers", SERVER)).toBeNull();
  });
});
