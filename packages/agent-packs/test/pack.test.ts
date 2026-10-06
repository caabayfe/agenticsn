import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { INSTRUCTIONS, PROMPTS, SKILLS, skillFiles } from "../src/index";

describe("the agent pack", () => {
  it("names skills as the Agent Skills standard requires, all servicenow-*", () => {
    for (const skill of SKILLS) {
      expect(skill.name).toMatch(/^servicenow-[a-z]+(?:-[a-z]+)*$/);
      expect(skill.name.length).toBeLessThanOrEqual(64);
      expect(skill.description.length).toBeGreaterThan(40);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
      expect(skill.description).not.toContain("\n");
    }
  });

  it("keeps every skill a short procedure with the fixed sections", () => {
    for (const { content } of skillFiles("1.2.3")) {
      expect(content.split("\n").length).toBeLessThanOrEqual(60);
      for (const section of ["When", "Steps", "Decide", "Output", "Stop and ask", "Never"]) {
        expect(content).toContain(`\n## ${section}\n`);
      }
    }
  });

  it("writes each skill where every compatible host looks, stamped with the version", () => {
    const files = skillFiles("1.2.3");
    expect(files.map((file) => file.path)).toEqual(
      SKILLS.map((skill) => `.agents/skills/${skill.name}/SKILL.md`),
    );
    expect(files[0]?.content).toStartWith(`---\nname: ${SKILLS[0]?.name}\ndescription: "`);
    expect(files[0]?.content).toContain("  generated-by: snagentic 1.2.3\n---\n");
  });

  it("writes front matter that YAML reads back as the skill's name and description", () => {
    for (const [index, { content }] of skillFiles("1.2.3").entries()) {
      const front = parse(content.split("\n---\n")[0]?.slice(4) ?? "");
      expect(front).toEqual({
        name: SKILLS[index]?.name,
        description: SKILLS[index]?.description,
        metadata: { "generated-by": "snagentic 1.2.3" },
      });
    }
  });

  it("keeps the always-loaded instructions under 30 lines, naming every skill", () => {
    expect(INSTRUCTIONS.split("\n").length).toBeLessThan(30);
    for (const skill of SKILLS) {
      expect(INSTRUCTIONS).toContain(skill.name);
    }
  });

  it("offers prompts that start a workflow with the user's request", () => {
    expect(PROMPTS.map((prompt) => prompt.name)).toEqual(["design", "review", "explain"]);
    const message = PROMPTS[2]?.message("why does priority change?") ?? "";
    expect(message).toStartWith(
      "Follow the servicenow-explain workflow for this request: why does priority change?",
    );
    expect(message).toContain("## Steps");
  });

  it("renders the explain skill exactly as reviewed", async () => {
    const explain = skillFiles("1.2.3").find((file) => file.path.includes("explain"));
    expect(explain?.content).toBe(
      await Bun.file(`${import.meta.dir}/golden/servicenow-explain.md`).text(),
    );
  });
});
