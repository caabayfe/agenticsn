import { describe, expect, it } from "bun:test";
import { gitProbe } from "../../src/adapters/git-probe";

describe("git probe", () => {
  it("reports the installed git version", async () => {
    const check = await gitProbe().run();
    expect(check).toMatchObject({ name: "git", status: "ok", hint: null });
    expect(check.detail).toStartWith("git version ");
  });

  it("fails with an install hint when git is missing", async () => {
    const check = await gitProbe(async () => {
      throw new Error("ENOENT");
    }).run();
    expect(check).toMatchObject({ status: "fail", detail: "git was not found" });
    expect(check.hint).toContain("install git");
  });

  it("fails when git is older than 2.30", async () => {
    const check = await gitProbe(async () => ({
      exitCode: 0,
      stdout: "git version 2.29.1\n",
    })).run();
    expect(check).toMatchObject({ status: "fail", hint: "upgrade git to 2.30 or newer" });
  });

  it("accepts git 2.30 exactly", async () => {
    const check = await gitProbe(async () => ({
      exitCode: 0,
      stdout: "git version 2.30.0\n",
    })).run();
    expect(check.status).toBe("ok");
  });

  it("fails on unrecognised version output", async () => {
    const check = await gitProbe(async () => ({ exitCode: 0, stdout: "hello" })).run();
    expect(check.status).toBe("fail");
  });

  it("fails when git exits with an error", async () => {
    const check = await gitProbe(async () => ({ exitCode: 128, stdout: "" })).run();
    expect(check).toMatchObject({ status: "fail", detail: "git --version exited with 128" });
  });
});
