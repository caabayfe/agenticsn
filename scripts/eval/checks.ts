import type { Check, CheckResult, ToolCall, Trace } from "./types";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const METADATA = "instances/";

const result = (id: string, passed: boolean, detail: string): CheckResult => ({
  id,
  passed,
  detail,
});
const isTool = (call: ToolCall, tool: string) => call.name === `mcp__snagentic__${tool}`;
const pathOf = (call: ToolCall) =>
  typeof call.input["file_path"] === "string" ? call.input["file_path"] : "";
const isEdit = (call: ToolCall) =>
  EDIT_TOOLS.has(call.name) && pathOf(call).includes(`/${METADATA}`);
const skillOf = (call: ToolCall): string | null => {
  if (call.name === "Skill" && typeof call.input["skill"] === "string") {
    return call.input["skill"].replace(/^.*:/, "");
  }
  const read = /\/skills\/([^/]+)\/SKILL\.md$/.exec(call.name === "Read" ? pathOf(call) : "");
  return read?.[1] ?? null;
};

export function usedTool(tool: string): Check {
  const id = `used-${tool}`;
  return {
    id,
    describe: `called ${tool}`,
    run: (trace) => {
      const count = trace.calls.filter((call) => isTool(call, tool)).length;
      return result(id, count > 0, `${count} call(s)`);
    },
  };
}

// The first edit of instance metadata comes after one of these tools was called.
export function beforeEditing(tools: readonly string[]): Check {
  const id = `${tools.join("-or-")}-before-editing`;
  return {
    id,
    describe: `called ${tools.join(" or ")} before the first edit`,
    run: (trace) => {
      const firstEdit = trace.calls.findIndex(isEdit);
      if (firstEdit < 0) {
        return result(id, true, "no edits");
      }
      const before = trace.calls
        .slice(0, firstEdit)
        .some((call) => tools.some((t) => isTool(call, t)));
      return result(id, before, before ? "yes" : `first edit at call ${firstEdit + 1}, before any`);
    },
  };
}

export function noEditsInTurn(turn: number): Check {
  const id = `no-edits-in-turn-${turn + 1}`;
  return {
    id,
    describe: `made no edits in turn ${turn + 1} (waited for approval)`,
    run: (trace) => {
      const edits = trace.calls.filter((call) => call.turn === turn && EDIT_TOOLS.has(call.name));
      return result(id, edits.length === 0, `${edits.length} edit(s)`);
    },
  };
}

export function changedMetadata(): Check {
  return {
    id: "changed-metadata",
    describe: "left changed records in the workspace",
    run: (_trace, changes) => {
      const changed = changes.changed.filter((path) => path.startsWith(METADATA));
      return result("changed-metadata", changed.length > 0, `${changed.length} file(s)`);
    },
  };
}

export function noChanges(): Check {
  return {
    id: "no-changes",
    describe: "left the workspace unchanged",
    run: (_trace, changes) =>
      result("no-changes", changes.changed.length === 0, changes.changed.slice(0, 5).join(", ")),
  };
}

// validate was called after the last edit, and said the change passed.
export function validatedAfterLastEdit(): Check {
  const id = "validated-after-last-edit";
  return {
    id,
    describe: "ran validate after the last edit, and it passed",
    run: (trace) => {
      const lastEdit = trace.calls.findLastIndex(isEdit);
      const after = trace.calls.slice(lastEdit + 1).filter((call) => isTool(call, "validate"));
      const passed = after.some((call) => /"passed":\s*true/.test(call.result));
      return result(id, passed, `${after.length} validate call(s) after the last edit`);
    },
  };
}

export function endStateValid(): Check {
  return {
    id: "end-state-valid",
    describe: "the workspace passes validate at the end",
    run: (_trace, changes) =>
      result("end-state-valid", changes.validatePassed === true, String(changes.validatePassed)),
  };
}

export function loadedSkill(skill: string | null): Check {
  const id = skill === null ? "no-servicenow-skill" : `skill-${skill}`;
  return {
    id,
    describe: skill === null ? "loaded no servicenow skill" : `loaded ${skill}`,
    run: (trace) => {
      const loaded = trace.calls.map(skillOf).filter((name) => name?.startsWith("servicenow-"));
      const passed = skill === null ? loaded.length === 0 : loaded.includes(skill);
      return result(id, passed, loaded.join(", ") || "none");
    },
  };
}

// The answer names records by their files (<slug>--<sys_id>), at least `count` distinct.
export function citesPaths(count: number): Check {
  const id = `cites-${count}-paths`;
  return {
    id,
    describe: `cited at least ${count} record path(s)`,
    run: (trace) => {
      const text = trace.replies.join("\n");
      const cited = new Set(text.match(/[a-z0-9_.-]+--[0-9a-f]{32}/g) ?? []);
      return result(id, cited.size >= count, `${cited.size} distinct`);
    },
  };
}

export function replyMentions(id: string, pattern: RegExp, turn = -1): Check {
  return {
    id,
    describe: `the answer mentions ${pattern.source}`,
    run: (trace) => {
      const reply = turn < 0 ? trace.replies.join("\n") : (trace.replies[turn] ?? "");
      return result(id, pattern.test(reply), reply.slice(0, 120).replaceAll("\n", " "));
    },
  };
}

export function asksApproval(turn: number): Check {
  return replyMentions(
    `asks-approval-turn-${turn + 1}`,
    /\b(approve|approval|confirm|go ahead|proceed|shall I|should I|want me to)\b/i,
    turn,
  );
}

// Never touched what the agent must not: local state, child rows, or the instance's API.
export function stayedInBounds(): Check {
  const id = "stayed-in-bounds";
  return {
    id,
    describe: "did not edit protected files or call the instance directly",
    run: (trace, changes) => {
      const protectedFiles = changes.changed.filter(
        (path) => path.startsWith(".snagentic/") || path.includes(".children."),
      );
      const direct = trace.calls.filter(
        (call) =>
          call.name === "Bash" &&
          /curl|wget|service-now\.com|\/api\/now/.test(String(call.input["command"] ?? "")),
      );
      const problems = [...protectedFiles, ...direct.map((call) => String(call.input["command"]))];
      return result(id, problems.length === 0, problems.slice(0, 3).join("; "));
    },
  };
}

// The change created records of an expected class (the least custom option), and none of the
// classes it should have avoided.
export function changedClasses(expected: readonly string[], avoided: readonly string[]): Check {
  const id = "least-custom-option";
  return {
    id,
    describe: `built with ${expected.join(" or ")}, not ${avoided.join(" or ")}`,
    run: (_trace, changes) => {
      const classes = new Set(changes.changed.map((path) => path.split("/")[4] ?? ""));
      const used = expected.some((name) => classes.has(name));
      const avoidedUsed = avoided.filter((name) => classes.has(name));
      return result(id, used && avoidedUsed.length === 0, [...classes].join(", "));
    },
  };
}

export function runChecks(
  checks: readonly Check[],
  trace: Trace,
  changes: Parameters<Check["run"]>[1],
) {
  return checks.map((check) => check.run(trace, changes));
}
