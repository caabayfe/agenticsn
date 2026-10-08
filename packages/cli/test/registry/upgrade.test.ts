import { afterEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex, VERSION } from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { upgrade } from "../../src/registry/upgrade";
import type { UseCaseContext } from "../../src/registry/use-case";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const NEXT = "99.0.0";
const BINARY = new TextEncoder().encode("new snagentic");

// GitHub with one newer release, and a binary that records what happens to it.
function withReleases(context: UseCaseContext, calls: string[]): UseCaseContext {
  return {
    ...context,
    upgrade: {
      releases: {
        latest: async () => ({ version: NEXT, notes: "" }),
        list: async () => [
          { version: NEXT, notes: "### ⚠️ Changed: log in again\n\nRun snagentic auth login." },
        ],
        download: async () => ({
          binary: BINARY,
          sums: `${sha256Hex(BINARY)}  snagentic-macos-arm64\n`,
        }),
      },
      binary: {
        path: "/usr/local/bin/snagentic",
        replace: async (_bytes, version) => {
          calls.push(`replace ${version}`);
        },
        run: async (args) => {
          calls.push(`run ${args.join(" ")}`);
          const files = [{ path: "AGENTS.md", status: "updated" }];
          return { exitCode: 0, stdout: JSON.stringify({ files }), stderr: "" };
        },
      },
      platform: "darwin",
      arch: "arm64",
    },
  };
}

describe("upgrade", () => {
  it("upgrades, refreshes the workspace's agent pack and shows the release's steps", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await writeFile(
      join(ws.root, "AGENTS.md"),
      `<!-- snagentic:begin ${VERSION} -->\nrules\n<!-- snagentic:end -->\n`,
    );
    const calls: string[] = [];
    const { output } = await executeUseCase(upgrade, {}, withReleases(ws.context, calls));
    expect(output).toMatchObject({
      status: "upgraded",
      from: VERSION,
      to: NEXT,
      workspace: ws.root,
      pack: ["AGENTS.md"],
    });
    expect(calls).toEqual([`replace ${NEXT}`, "run agent install --format json"]);
    const text = upgrade.render(output as never, "text");
    expect(text).toStartWith(`upgraded snagentic ${VERSION} -> ${NEXT}`);
    expect(text).toContain(`before you go on, from the ${NEXT} release notes:`);
    expect(text).toContain("Run snagentic auth login.");
    expect(text).toContain(`agent pack updated in ${ws.root}; commit: AGENTS.md`);
  });

  it("works outside a workspace, and says when it is already current", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const outside = { ...ws.context, host: { ...ws.context.host, cwd: "/" } };
    const calls: string[] = [];
    const { output } = await executeUseCase(upgrade, {}, withReleases(outside, calls));
    expect(output).toMatchObject({ status: "upgraded", workspace: null, pack: [] });
    const current = await executeUseCase(upgrade, { to: VERSION }, withReleases(outside, []));
    expect(upgrade.render(current.output as never, "text")).toBe(
      `snagentic ${VERSION} is the latest release`,
    );
  });
});
