import { describe, expect, it } from "bun:test";
import { macosProfile, NO_SANDBOX, osSandbox } from "../../../src/adapters/fluent/worker-sandbox";

describe("the SDK worker's sandbox (ADR-0044)", () => {
  const command = ["/bin/snagentic", "__fluent-worker"];

  it("uses sandbox-exec on macOS", () => {
    const sandbox = osSandbox({ platform: "darwin", exists: () => true });
    const { command: wrapped, isolation } = sandbox(command, ["/p"]);
    expect(isolation).toBe("sandbox-exec");
    expect(wrapped).toEqual(["/usr/bin/sandbox-exec", "-p", macosProfile(["/p"]), ...command]);
  });

  it("runs the worker without one where there is none", () => {
    for (const host of [
      { platform: "darwin" as const, exists: () => false },
      { platform: "win32" as const, exists: () => true },
    ]) {
      expect(osSandbox(host)(command, ["/p"])).toEqual({ command, isolation: "none" });
    }
    expect(NO_SANDBOX(command, ["/p"])).toEqual({ command, isolation: "none" });
  });

  it("denies the network and writes outside the given folders, quoting their names", () => {
    const profile = macosProfile(["/tmp/a b", '/tmp/q"uote\\d']);
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(subpath "/tmp/a b")');
    expect(profile).toContain('(subpath "/tmp/q\\"uote\\\\d")');
    expect(profile).toContain("(deny file-write* (require-not (require-any");
  });
});
