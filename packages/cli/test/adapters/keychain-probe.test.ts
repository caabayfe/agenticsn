import { describe, expect, it } from "bun:test";
import { type KeychainEntry, keychainProbe } from "../../src/adapters/keychain-probe";

function entryThat(behavior: Partial<KeychainEntry>, deletions: string[] = []): KeychainEntry {
  let stored: string | undefined;
  return {
    setPassword: async (password) => {
      stored = password;
    },
    getPassword: async () => stored,
    deletePassword: async () => {
      deletions.push("deleted");
      return true;
    },
    ...behavior,
  };
}

const refuse = async (): Promise<never> => {
  throw new Error("access denied");
};

describe("keychain probe", () => {
  it.if(process.platform !== "linux")(
    "round-trips a random value through the real OS keychain and removes it",
    async () => {
      const check = await keychainProbe().run();
      expect(check).toMatchObject({ name: "keychain", status: "ok", hint: null });
    },
  );

  it("passes when the value read back matches", async () => {
    const check = await keychainProbe(() => entryThat({}), "darwin").run();
    expect(check).toMatchObject({
      status: "ok",
      detail: "macOS Keychain: write, read and delete succeeded",
    });
  });

  it("fails on macOS and Windows when the keychain refuses access", async () => {
    const check = await keychainProbe(() => entryThat({ setPassword: refuse }), "win32").run();
    expect(check).toMatchObject({ status: "fail" });
    expect(check.hint).toBe("allow snagentic to use the Windows Credential Manager");
  });

  it("reports unavailable on Linux without a Secret Service, pointing to environment variables", async () => {
    const check = await keychainProbe(() => entryThat({ setPassword: refuse }), "linux").run();
    expect(check.status).toBe("unavailable");
    expect(check.hint).toContain("environment variables");
  });

  it("fails when the value read back differs", async () => {
    const check = await keychainProbe(
      () => entryThat({ getPassword: async () => "something else" }),
      "darwin",
    ).run();
    expect(check).toMatchObject({
      status: "fail",
      detail: "macOS Keychain returned a different value",
    });
  });

  it("removes the probe entry even when reading fails", async () => {
    const deletions: string[] = [];
    await keychainProbe(() => entryThat({ getPassword: refuse }, deletions), "darwin").run();
    expect(deletions).toEqual(["deleted"]);
  });

  it("still reports the original problem when removal also fails", async () => {
    const check = await keychainProbe(
      () => entryThat({ getPassword: refuse, deletePassword: refuse }),
      "darwin",
    ).run();
    expect(check.detail).toBe("macOS Keychain refused access: access denied");
  });

  it("names a generic credential store on other platforms", async () => {
    const check = await keychainProbe(() => entryThat({}), "freebsd").run();
    expect(check.detail).toStartWith("OS credential store:");
  });
});
