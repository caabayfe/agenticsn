import { describe, expect, it } from "bun:test";
import { installUserSkills } from "../../src/workspace/application/install-user-skills";

function fixture() {
  const data = new Map<string, string>();
  const checked: string[] = [];
  const files = {
    read: async (path: string) => data.get(path) ?? null,
    write: async (path: string, text: string) => {
      data.set(path, text);
    },
    remove: async (path: string) => {
      data.delete(path);
    },
    list: async () => [],
    guard: async (root: string, path: string) => {
      checked.push(`${root}:${path}`);
    },
  };
  const skills = [{ path: ".agents/skills/servicenow-test/SKILL.md", content: "v1" }];
  return { data, files, skills, checked };
}

describe("user skill installation", () => {
  it("shares installed skills across workspaces and updates only owned unchanged files", async () => {
    const { data, files, skills, checked } = fixture();
    expect((await installUserSkills(files, "/home/me", skills))[0]?.status).toBe("created");
    expect((await installUserSkills(files, "/home/me", skills))[0]?.status).toBe("unchanged");
    const next = [{ path: ".agents/skills/servicenow-test/SKILL.md", content: "v2" }];
    expect((await installUserSkills(files, "/home/me", next))[0]?.status).toBe("updated");
    expect(data.get("/home/me/.agents/skills/servicenow-test/SKILL.md")).toBe("v2");
    expect(checked.length).toBeGreaterThan(0);
  });

  it("preserves edited and unowned personal skills", async () => {
    const { data, files, skills } = fixture();
    const path = "/home/me/.agents/skills/servicenow-test/SKILL.md";
    data.set(path, "personal workflow");
    expect((await installUserSkills(files, "/home/me", skills))[0]?.status).toBe("skipped");
    expect(data.get(path)).toBe("personal workflow");
    data.delete(path);
    await installUserSkills(files, "/home/me", skills);
    data.set(path, "my edits");
    expect((await installUserSkills(files, "/home/me", skills))[0]?.status).toBe("skipped");
    expect(data.get(path)).toBe("my edits");
  });

  it("does not add bundled references to an unowned personal skill", async () => {
    const { data, files, skills } = fixture();
    data.set("/home/me/.agents/skills/servicenow-test/SKILL.md", "personal");
    const reference = {
      path: ".agents/skills/servicenow-test/references/queries.md",
      content: "bundled",
    };
    const result = await installUserSkills(files, "/home/me", [...skills, reference]);
    expect(result.map((file) => file.status)).toEqual(["skipped", "skipped"]);
    expect(data.size).toBe(1);
  });

  it("refuses an invalid ownership manifest instead of overwriting personal files", async () => {
    const { data, files, skills } = fixture();
    data.set("/home/me/.snagentic/agent-pack/skills.json", "broken");
    await expect(installUserSkills(files, "/home/me", skills)).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(data.size).toBe(1);
  });

  it("rejects paths outside managed skill folders", async () => {
    const { files } = fixture();
    await expect(
      installUserSkills(files, "/home/me", [{ path: "../../AGENTS.md", content: "bad" }]),
    ).rejects.toThrow();
  });

  it("checks destinations before reading or writing them", async () => {
    const { files, skills, data } = fixture();
    const unsafe = {
      ...files,
      guard: async () => {
        throw new Error("symlink");
      },
    };
    await expect(installUserSkills(unsafe, "/home/me", skills)).rejects.toThrow("symlink");
    expect(data.size).toBe(0);
  });
});
