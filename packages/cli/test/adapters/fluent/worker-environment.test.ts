import { describe, expect, it } from "bun:test";
import { workerEnvironment } from "../../../src/adapters/fluent/worker-environment";

describe("the SDK worker's environment (ADR-0044)", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    LANG: "en_GB.UTF-8",
    SystemRoot: "C:\\Windows",
    SNAGENTIC_PDI2_PASSWORD: "secret",
    GITHUB_TOKEN: "ghp_x",
    AWS_SECRET_ACCESS_KEY: "aws",
    BUN_BE_BUN: "1",
    NODE_OPTIONS: "--require x",
    TMPDIR: "/tmp/shared",
    UNSET: undefined,
  };

  it("passes what starting a process needs, nothing to sign in with", () => {
    expect(workerEnvironment("/scratch", parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_GB.UTF-8",
      SystemRoot: "C:\\Windows",
      TMPDIR: "/scratch",
      TMP: "/scratch",
      TEMP: "/scratch",
      NO_TELEMETRY: "1",
    });
  });
});
