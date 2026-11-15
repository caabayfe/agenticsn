import type { Skill } from "../skill";

export const TEST: Skill = {
  name: "servicenow-test",
  description:
    "Plan and assess tests for a ServiceNow feature or fix: regression cases, ACL behavior, script logic, UI accessibility and integration boundaries. Distinguish static validation from runtime tests.",
  when: "A ServiceNow implementation or bug fix needs test cases or verification evidence.",
  steps: [
    "Read the request and existing implementation with `describe`. Use `advise` for relevant platform constraints and rules before choosing assertions.",
    "Define observable acceptance cases, including the reported regression, negative permissions, scope/domain boundaries and failures at external integrations. For UI changes, include keyboard operation, focus, labels, reflow and target size.",
    "Use small local tests for pure logic and mock external boundaries. Execute the project's existing local test commands where available; report actual command output.",
    "Run `validate` for changed Fluent units and report `passed`, findings, `notChecked` and `rulesNotChecked`. This is static governance, not proof of runtime correctness.",
    "Describe development-only runtime or ATF cases with setup, expected result and cleanup. This MCP has no runtime test executor; do not claim those cases ran. Use servicenow-deliver for any approved gated development delivery.",
  ],
  decide: [
    "Missing runtime evidence stays unverified.",
    "Test fixtures must be synthetic; an ACL denial is a test result, not a reason to use a more privileged identity.",
  ],
  output:
    "Cases and acceptance criteria, local tests actually run, static validation results, and runtime cases still needing execution.",
  stopAndAsk:
    "When a required runtime test needs instance changes or a person to execute it; prepare the concrete case first and respect authorization already given.",
  never: [
    "Never equate a passing validation gate with executed ATF or browser tests.",
    "Never test by changing production or weakening ACLs, credentials or the delivery gate.",
  ],
  prompt: { name: "test", description: "Plan and verify tests for a ServiceNow change" },
};
