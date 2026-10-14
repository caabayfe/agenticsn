import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fluentProbe } from "../../../src/adapters/fluent/fluent-probe";
import { PROBE_KEYS_FILE, PROBE_RECORD } from "../../../src/adapters/fluent/fluent-probe-project";
import type { FluentBuildOutcome, FluentRuntime } from "../../../src/adapters/fluent/sdk-runtime";

function fakeRuntime(
  build: (projectDir: string) => FluentBuildOutcome,
): () => Promise<FluentRuntime> {
  return async () => ({ sdkVersion: "9.9.9", build: async (dir) => build(dir) });
}

const built: FluentBuildOutcome = { success: true, records: [PROBE_RECORD] };

describe("fluent probe", () => {
  it("passes with the SDK version when the build makes the one test flow and keeps its keys", async () => {
    const check = await fluentProbe(fakeRuntime(() => built)).run();
    expect(check).toMatchObject({ name: "fluent", status: "ok", hint: null });
    expect(check.detail).toMatch(/^ServiceNow SDK 9\.9\.9: built a test flow in \d+ ms$/);
  });

  it("fails when the build changes the project's keys", async () => {
    const check = await fluentProbe(
      fakeRuntime((dir) => {
        writeFileSync(join(dir, PROBE_KEYS_FILE), "// adopted keys");
        return built;
      }),
    ).run();
    expect(check).toMatchObject({ status: "fail" });
    expect(check.detail).toContain("changed the project's keys");
  });

  it("fails when the build makes records other than the test flow", async () => {
    const check = await fluentProbe(
      fakeRuntime(() => ({ success: true, records: [PROBE_RECORD, "dist/app/x.xml"] })),
    ).run();
    expect(check.detail).toContain("built 2 records instead of the test flow");
  });

  it("fails with the first error of a failed build", async () => {
    const error = { file: "src/fluent/probe.now.ts", line: 1, column: 1, code: "ts2307" };
    const check = await fluentProbe(
      fakeRuntime(() => ({ success: false, errors: [{ ...error, message: "no module" }] })),
    ).run();
    expect(check).toMatchObject({ status: "fail" });
    expect(check.detail).toContain("build failed: ts2307 no module");
    expect(check.hint).toContain("reinstall snagentic");
  });

  it("fails when the SDK cannot be loaded", async () => {
    const check = await fluentProbe(async () => {
      throw new Error("the embedded ServiceNow SDK is incomplete");
    }).run();
    expect(check).toMatchObject({
      status: "fail",
      detail: "the embedded ServiceNow SDK is incomplete",
    });
  });

  it("leaves no temporary folder behind", async () => {
    const root = mkdtempSync(join(tmpdir(), "probe-root-"));
    await fluentProbe(
      fakeRuntime(() => built),
      root,
    ).run();
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(root)).toBe(true);
  });
});
