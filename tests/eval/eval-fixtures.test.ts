import { afterEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runGitOrThrow } from "../../packages/cli/src/adapters/git/run-git";
import { executeUseCase } from "../../packages/cli/src/registry/execute";
import { validate } from "../../packages/cli/src/registry/validate";
import { instanceWorkspace } from "../../packages/cli/test/support/instance-workspace";
import { SDK_BUILD_TIMEOUT } from "../../packages/cli/test/support/sdk-contract";
import {
  ADOPTED_RULE,
  adoptedProject,
  blockedChange,
  injectedInclude,
  mirrorOnlyRule,
  PROJECT,
  readyChange,
  riskyChange,
} from "../../scripts/eval/fixtures";
import type { Fixture } from "../../scripts/eval/types";

// The scenarios promise what validate says about their fixtures (scripts/eval/README.md). These
// tests hold them to it with the real build, so a rule or SDK change cannot quietly turn a
// scenario into one no agent can pass, or one every agent passes.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

// A workspace holding the committed fixtures, then the user's uncommitted work.
async function workspace(work?: Fixture) {
  const ws = await instanceWorkspace({});
  cleanups.push(ws.cleanup);
  const context = { instance: "pdi" };
  for (const fixture of [adoptedProject, mirrorOnlyRule, injectedInclude]) {
    await fixture(ws.root, context);
  }
  await git(ws.root, "add", ".");
  await git(ws.root, "commit", "-qm", "eval: scenario fixture");
  await git(ws.root, "branch", "servicenow-remote/pdi");
  await work?.(ws.root, context);
  const check = async () => (await executeUseCase(validate, {}, ws.context)).output;
  return { root: ws.root, check };
}

describe("the evaluation fixtures, under the real validate", () => {
  it(
    "start clean: the committed project and mirror records are no change and no finding",
    async () => {
      const { check } = await workspace();
      expect(await check()).toMatchObject({ passed: true, units: 0, findings: [] });
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "block the payload reader for eval alone, and pass once it reads JSON with JSON.parse",
    async () => {
      const { root, check } = await workspace(blockedChange);
      const reader = `${PROJECT}/src/server/payload-reader.js`;
      const blocked = await check();
      expect(blocked).toMatchObject({
        passed: false,
        counts: { block: 1, warn: 0 },
        findings: [{ ruleId: "SN-SEC-001", path: reader }],
      });
      await writeFile(
        join(root, reader),
        [
          "var EvalPayloadReader = Class.create();",
          "EvalPayloadReader.prototype = {",
          "    initialize: function () {},",
          "    read: function (text) {",
          "        return JSON.parse(text);",
          "    },",
          "    type: 'EvalPayloadReader'",
          "};",
          "",
        ].join("\n"),
      );
      expect(await check()).toMatchObject({ passed: true, units: 1, findings: [] });
    },
    SDK_BUILD_TIMEOUT * 2,
  );

  it(
    "give the review a change whose eval is reported with its rule and file",
    async () => {
      const { check } = await workspace(riskyChange);
      const output = await check();
      expect(output).toMatchObject({ passed: false });
      expect(JSON.stringify(output)).toContain("SN-SEC-001");
      expect(JSON.stringify(output)).toContain("incident-cleanup.js");
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "hold a change to the adopted rule that is ready to deliver",
    async () => {
      const { check } = await workspace(readyChange);
      expect(await check()).toMatchObject({ passed: true, units: 1, findings: [] });
      expect(ADOPTED_RULE.script.startsWith(PROJECT)).toBe(true);
    },
    SDK_BUILD_TIMEOUT,
  );
});
