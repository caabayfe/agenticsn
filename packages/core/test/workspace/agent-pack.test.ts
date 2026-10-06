import { describe, expect, it } from "bun:test";
import {
  type AgentPack,
  installAgentPack,
  installedPackVersion,
  type WorkspaceFiles,
  withAgentsImport,
  withInstructions,
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
  const port: WorkspaceFiles = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      writes.push(path);
      files.set(path, content);
    },
  };
  return { port, files, writes };
}

const PACK: AgentPack = {
  version: "1.1.0",
  instructions: BLOCK,
  files: [{ path: ".agents/skills/servicenow-explain/SKILL.md", content: "skill" }],
};

describe("installAgentPack", () => {
  it("writes the skills, the instructions block and the CLAUDE.md import", async () => {
    const { port, files } = memoryFiles({ "/w/CLAUDE.md": "# notes\n" });
    expect(await installAgentPack(port, "/w", PACK)).toEqual([
      { path: ".agents/skills/servicenow-explain/SKILL.md", status: "created" },
      { path: "AGENTS.md", status: "created" },
      { path: "CLAUDE.md", status: "updated" },
    ]);
    expect(files.get("/w/AGENTS.md")).toContain("<!-- snagentic:begin 1.1.0 -->");
  });

  it("writes nothing when the pack is already installed", async () => {
    const { port, writes } = memoryFiles();
    await installAgentPack(port, "/w", PACK);
    writes.length = 0;
    const second = await installAgentPack(port, "/w", PACK);
    expect(second.map((file) => file.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(writes).toEqual([]);
  });
});
