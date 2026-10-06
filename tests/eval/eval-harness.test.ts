import { describe, expect, it } from "bun:test";
import {
  asksApproval,
  beforeEditing,
  changedClasses,
  citesPaths,
  loadedSkill,
  noEditsInTurn,
  stayedInBounds,
  usedTool,
  validatedAfterLastEdit,
} from "../../scripts/eval/checks";
import { renderReport, summarize } from "../../scripts/eval/report";
import { parseClaudeStreams, splitTurns } from "../../scripts/eval/trace";
import type { RunResult, ToolCall, Trace, WorkspaceChanges } from "../../scripts/eval/types";

const line = (event: unknown) => JSON.stringify(event);
const use = (id: string, name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const answer = (id: string, content: unknown, isError = false) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });

describe("parseClaudeStreams", () => {
  it("pairs tool calls with their results across turns, with cost, model and skills", () => {
    const first = [
      line({ type: "system", subtype: "init", model: "claude-x", skills: ["servicenow-explain"] }),
      use("t1", "Skill", { skill: "servicenow-explain" }),
      answer("t1", "Launching skill"),
      use("t2", "mcp__snagentic__describe", { target: "incident" }),
      answer("t2", [{ type: "text", text: '{"kind":"table"}' }]),
      line({ type: "assistant", message: { content: [{ type: "text", text: "draft" }] } }),
      line({
        type: "result",
        subtype: "success",
        result: "Here is the design.",
        total_cost_usd: 0.5,
        duration_ms: 2000,
      }),
    ].join("\n");
    const second = [
      "not json",
      use("t3", "Edit", { file_path: "/w/instances/pdi/metadata/a.yaml" }),
      answer("t3", "denied", true),
      line({
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        total_cost_usd: 0.25,
        duration_ms: 1000,
      }),
    ].join("\n");
    const trace = parseClaudeStreams([first, second]);
    expect(trace.calls.map((call) => [call.turn, call.name, call.result, call.isError])).toEqual([
      [0, "Skill", "Launching skill", false],
      [0, "mcp__snagentic__describe", '{"kind":"table"}', false],
      [1, "Edit", "denied", true],
    ]);
    expect(trace).toMatchObject({
      replies: ["Here is the design.", ""],
      skillsAvailable: ["servicenow-explain"],
      costUsd: 0.75,
      seconds: 3,
      model: "claude-x",
      error: "error_max_budget_usd",
    });
  });

  it("splits a saved transcript back into its turns", () => {
    const turns = splitTurns(
      [
        '{"type":"system"}',
        '{"type":"result","a":1}',
        '{"type":"system"}',
        '{"type":"result","a":2}',
        "",
      ].join("\n"),
    );
    expect(turns).toEqual([
      '{"type":"system"}\n{"type":"result","a":1}',
      '{"type":"system"}\n{"type":"result","a":2}',
    ]);
    expect(splitTurns('{"type":"system"}\n{"type":"assistant"}')).toEqual([
      '{"type":"system"}\n{"type":"assistant"}',
    ]);
  });

  it("keeps calls that were cut off before their result", () => {
    const trace = parseClaudeStreams([use("t1", "mcp__snagentic__find", { text: "x" })]);
    expect(trace.calls).toEqual([
      { name: "mcp__snagentic__find", input: { text: "x" }, result: "", isError: true, turn: 0 },
    ]);
  });
});

const call = (
  name: string,
  input: Record<string, unknown> = {},
  extra: Partial<ToolCall> = {},
): ToolCall => ({
  name,
  input,
  result: "",
  isError: false,
  turn: 0,
  ...extra,
});
const trace = (calls: ToolCall[], replies: string[] = [""]): Trace => ({
  calls,
  replies,
  skillsAvailable: [],
  costUsd: 0,
  seconds: 0,
  model: "m",
  error: null,
});
const NONE: WorkspaceChanges = { changed: [], validatePassed: null };
const edit = (turn = 0) =>
  call("Edit", { file_path: "/w/instances/pdi/metadata/x.yaml" }, { turn });
const tool = (name: string, result = "") => call(`mcp__snagentic__${name}`, {}, { result });

describe("behavior checks", () => {
  it("knows whether the agent looked before it edited", () => {
    const check = beforeEditing(["describe", "advise"]);
    expect(check.run(trace([tool("describe"), edit()]), NONE).passed).toBe(true);
    expect(check.run(trace([edit(), tool("describe")]), NONE).passed).toBe(false);
    expect(check.run(trace([tool("find")]), NONE)).toMatchObject({
      passed: true,
      detail: "no edits",
    });
  });

  it("counts the same tools called through the CLI, when the agent has no MCP server", () => {
    const cli = (command: string, result = "") => call("Bash", { command }, { result });
    expect(
      usedTool("describe").run(trace([cli("snagentic describe incident --format agent")]), NONE)
        .passed,
    ).toBe(true);
    expect(
      usedTool("plan_push").run(trace([cli("cd x; snagentic plan-push 2>&1 | head")]), NONE).passed,
    ).toBe(true);
    expect(usedTool("describe").run(trace([cli("snagentic describer")]), NONE).passed).toBe(false);
    const check = validatedAfterLastEdit();
    expect(
      check.run(
        trace([
          edit(),
          cli("snagentic validate", "1 record(s) checked against HEAD: 0 block, 1 warn, 0 info"),
        ]),
        NONE,
      ).passed,
    ).toBe(true);
    expect(
      check.run(
        trace([
          edit(),
          cli("snagentic validate", "1 record(s) checked against HEAD: 2 block, 0 warn, 0 info"),
        ]),
        NONE,
      ).passed,
    ).toBe(false);
  });

  it("requires a passing validate after the last edit", () => {
    const check = validatedAfterLastEdit();
    expect(check.run(trace([edit(), tool("validate", '{"passed":true}')]), NONE).passed).toBe(true);
    expect(check.run(trace([tool("validate", '{"passed":true}'), edit()]), NONE).passed).toBe(
      false,
    );
    expect(check.run(trace([edit(), tool("validate", '{"passed":false}')]), NONE).passed).toBe(
      false,
    );
  });

  it("sees edits per turn, tools used and skills loaded by the Skill tool or by reading SKILL.md", () => {
    expect(noEditsInTurn(0).run(trace([edit(1)]), NONE).passed).toBe(true);
    expect(noEditsInTurn(1).run(trace([edit(1)]), NONE).passed).toBe(false);
    expect(usedTool("advise").run(trace([tool("advise")]), NONE).passed).toBe(true);
    const viaSkill = trace([call("Skill", { skill: "snagentic:servicenow-review" })]);
    const viaRead = trace([
      call("Read", { file_path: "/w/.claude/skills/servicenow-review/SKILL.md" }),
    ]);
    expect(loadedSkill("servicenow-review").run(viaSkill, NONE).passed).toBe(true);
    expect(loadedSkill("servicenow-review").run(viaRead, NONE).passed).toBe(true);
    expect(loadedSkill(null).run(viaRead, NONE).passed).toBe(false);
    expect(loadedSkill(null).run(trace([]), NONE).passed).toBe(true);
  });

  it("reads the answers: cited record paths and a request for approval", () => {
    const reply =
      "See rule--0123456789abcdef0123456789abcdef and acl--fedcba9876543210fedcba9876543210. Shall I proceed?";
    expect(citesPaths(2).run(trace([], [reply]), NONE).passed).toBe(true);
    expect(citesPaths(3).run(trace([], [reply]), NONE).passed).toBe(false);
    expect(asksApproval(0).run(trace([], [reply]), NONE).passed).toBe(true);
    expect(asksApproval(0).run(trace([], ["Done."]), NONE).passed).toBe(false);
  });

  it("flags protected files and direct calls to the instance", () => {
    const check = stayedInBounds();
    expect(
      check.run(trace([]), { changed: ["instances/pdi/metadata/a.yaml"], validatePassed: true })
        .passed,
    ).toBe(true);
    expect(
      check.run(trace([]), { changed: [".snagentic/pdi/x"], validatePassed: true }).passed,
    ).toBe(false);
    expect(
      check.run(trace([call("Bash", { command: "curl https://x.service-now.com" })]), NONE).passed,
    ).toBe(false);
  });

  it("knows which classes the change created", () => {
    const check = changedClasses(["sys_ui_policy"], ["sys_script_client"]);
    const at = (cls: string) => `instances/pdi/metadata/global/${cls}/x--1.yaml`;
    expect(
      check.run(trace([]), { changed: [at("sys_ui_policy")], validatePassed: true }).passed,
    ).toBe(true);
    expect(
      check.run(trace([]), {
        changed: [at("sys_ui_policy"), at("sys_script_client")],
        validatePassed: true,
      }).passed,
    ).toBe(false);
  });
});

describe("the report", () => {
  const run = (scenario: string, variant: string, passed: boolean, costUsd: number): RunResult => ({
    scenario,
    variant,
    repetition: 1,
    checks: [{ id: "used-describe", passed, detail: "" }],
    changed: [],
    costUsd,
    seconds: 10,
    toolCalls: 3,
    model: "m",
    error: null,
  });

  it("summarizes pass rates and cost per scenario and variant", () => {
    const cells = summarize([
      run("s1", "A", true, 1),
      run("s1", "A", false, 3),
      run("s1", "B", true, 2),
    ]);
    expect(cells).toEqual([
      expect.objectContaining({
        scenario: "s1",
        variant: "A",
        runs: 2,
        passRate: 0.5,
        meanCostUsd: 2,
      }),
      expect.objectContaining({ scenario: "s1", variant: "B", runs: 1, passRate: 1 }),
    ]);
    const report = renderReport(cells, "Test");
    expect(report).toContain("| s1 | 50% (2) | 100% (1) |");
    expect(report).toContain("- A: 2 runs, $4.00, 50% mean pass rate");
    expect(report).toContain("- s1 / A: used-describe passed 50%");
  });
});
