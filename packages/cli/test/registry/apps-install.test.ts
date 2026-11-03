import { afterEach, describe, expect, it } from "bun:test";
import { appsInstall } from "../../src/registry/apps-install";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const OFFER = {
  sys_id: "r1",
  scope: "sn_ztsd",
  name: "Zero Touch Service Desk",
  latest_version: "3.3.3",
  block_install: "false",
};

async function instanceWith(
  kind: "development" | "test",
  tables: { installed?: Record<string, string>[]; roles?: string[] } = {},
) {
  const ws = await instanceWorkspace(
    {
      sys_remote_app: [OFFER],
      sys_scope: tables.installed ?? [],
      sys_user_has_role: (tables.roles ?? []).map((role) => ({
        sys_id: role,
        user: "u1",
        state: "active",
        "role.name": role,
      })),
    },
    kind,
  );
  cleanups.push(ws.cleanup);
  return ws;
}

describe("apps install (spec 011, I3)", () => {
  it("needs --confirm, and installs nothing without it", async () => {
    const { context, instance } = await instanceWith("development");
    await expect(
      executeUseCase(appsInstall, { instance: "pdi", scope: "sn_ztsd" }, context),
    ).rejects.toMatchObject({ code: "confirmation-required" });
    expect(instance.installs).toEqual([]);
  });

  it("does not exist for a test instance, confirmed or not", async () => {
    const { context, instance } = await instanceWith("test", { roles: ["snc_read_only"] });
    await expect(
      executeUseCase(appsInstall, { instance: "pdi", scope: "sn_ztsd", confirm: true }, context),
    ).rejects.toMatchObject({ code: "development-instance-required" });
    expect(instance.installs).toEqual([]);
  });

  it("installs the store's latest version on a development instance and suggests pulling", async () => {
    const { context, instance } = await instanceWith("development");
    const { output } = await executeUseCase(
      appsInstall,
      { instance: "pdi", scope: "sn_ztsd", confirm: true },
      context,
    );
    expect(output).toMatchObject({
      state: "installed",
      name: "Zero Touch Service Desk",
      version: "3.3.3",
      progressId: "progress-sn_ztsd",
    });
    expect(instance.installs).toEqual(["sn_ztsd 3.3.3"]);
    expect(appsInstall.render(output as never, "text")).toContain("next: snagentic pull pdi");
  });

  it("installs the version named", async () => {
    const { context, instance } = await instanceWith("development");
    await executeUseCase(
      appsInstall,
      { instance: "pdi", scope: "sn_ztsd", version: "3.2.0", confirm: true },
      context,
    );
    expect(instance.installs).toEqual(["sn_ztsd 3.2.0"]);
  });

  it("loads the application's demo data with --demo-data (ADR-0048)", async () => {
    const { context, instance } = await instanceWith("development");
    await executeUseCase(
      appsInstall,
      { instance: "pdi", scope: "sn_ztsd", demoData: true, confirm: true },
      context,
    );
    expect(instance.installs).toEqual(["sn_ztsd 3.3.3 with demo data"]);
  });

  it("changes nothing for an application already installed", async () => {
    const { context, instance } = await instanceWith("development", {
      installed: [{ sys_id: "s1", scope: "sn_ztsd", name: "ZTSD", version: "3.3.3" }],
    });
    const { output } = await executeUseCase(
      appsInstall,
      { instance: "pdi", scope: "sn_ztsd", confirm: true },
      context,
    );
    expect(output["state"]).toBe("already-installed");
    expect(instance.installs).toEqual([]);
    expect(appsInstall.render(output as never, "text")).toContain("nothing was changed");
  });
});
