import { describe, expect, it } from "bun:test";
import {
  type ActivationProgress,
  InstanceError,
  installStoreApp,
  KeysetPager,
  type StoreAppInstaller,
  storeOffers,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const LIVE = new AbortController().signal;
const step = (
  status: ActivationProgress["status"],
  percent = 0,
  extra: Partial<ActivationProgress> = {},
): ActivationProgress => ({
  progressId: "prog1",
  status,
  percent,
  message: "",
  error: "",
  ...extra,
});

const OFFERED = {
  sys_id: "r1",
  scope: "sn_ztsd",
  name: "Zero Touch Service Desk",
  latest_version: "3.3.3",
  block_install: "false",
};

function setup(
  tables: { installed?: Record<string, string>[]; offered?: Record<string, string>[] },
  progress: (ActivationProgress | Error)[],
  start: ActivationProgress | Error = step("pending"),
) {
  const instance = fakeInstance({
    sys_scope: tables.installed ?? [],
    sys_remote_app: tables.offered ?? [OFFERED],
  });
  const calls = { install: [] as string[], progress: 0 };
  let time = 0;
  const installer: StoreAppInstaller = {
    install: async (scope, version, demoData) => {
      calls.install.push(`${scope} ${version}${demoData ? " with demo data" : ""}`);
      if (start instanceof Error) throw start;
      return start;
    },
    progress: async () => {
      const next = progress[calls.progress] ?? step("running");
      calls.progress += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const deps = {
    pager: new KeysetPager(instance.reader),
    installer,
    sleep: async (ms: number) => {
      time += ms;
    },
    now: () => new Date(time),
  };
  return { deps, calls };
}

const LIMITS = { pollMs: 5_000, maxWaitMs: 60_000 };

describe("storeOffers (spec 011, I3)", () => {
  it("returns the store's latest version of each scope asked for, and whether it is blocked", async () => {
    const { deps } = setup(
      {
        offered: [
          OFFERED,
          {
            ...OFFERED,
            sys_id: "r2",
            scope: "sn_dex",
            latest_version: "5.3.2",
            block_install: "true",
          },
          { ...OFFERED, sys_id: "r3", scope: "sn_other" },
        ],
      },
      [],
    );
    expect(await storeOffers(deps.pager, ["sn_ztsd", "sn_dex"], LIVE)).toEqual([
      { scope: "sn_ztsd", version: "3.3.3", blocked: false },
      { scope: "sn_dex", version: "5.3.2", blocked: true },
    ]);
  });

  it("asks nothing for no scopes", async () => {
    const { deps } = setup({}, []);
    expect(await storeOffers(deps.pager, [], LIVE)).toEqual([]);
  });
});

describe("installStoreApp (spec 011, I3)", () => {
  it("does nothing for an application installed at the version asked or newer", async () => {
    const { deps, calls } = setup(
      { installed: [{ sys_id: "s1", scope: "sn_ztsd", name: "ZTSD", version: "3.4.0" }] },
      [],
    );
    expect(
      await installStoreApp(deps, "pdi", "sn_ztsd", { version: "3.3.3", demoData: false }, LIVE),
    ).toEqual({
      state: "already-installed",
      name: "ZTSD",
      version: "3.4.0",
    });
    expect(calls.install).toEqual([]);
  });

  it("refuses to upgrade an older installed version: that is Application Manager's", async () => {
    const { deps, calls } = setup(
      { installed: [{ sys_id: "s1", scope: "sn_ztsd", name: "ZTSD", version: "3.0.0" }] },
      [],
    );
    await expect(
      installStoreApp(deps, "pdi", "sn_ztsd", { version: "3.3.3", demoData: false }, LIVE),
    ).rejects.toMatchObject({
      code: "store-app-outdated",
    });
    expect(calls.install).toEqual([]);
  });

  it("refuses an application the store does not offer, or blocks", async () => {
    const none = setup({ offered: [] }, []);
    await expect(
      installStoreApp(none.deps, "pdi", "sn_ztsd", { version: null, demoData: false }, LIVE),
    ).rejects.toMatchObject({
      code: "store-app-not-offered",
    });
    const blocked = setup({ offered: [{ ...OFFERED, block_install: "true" }] }, []);
    await expect(
      installStoreApp(blocked.deps, "pdi", "sn_ztsd", { version: null, demoData: false }, LIVE),
    ).rejects.toMatchObject({ code: "store-app-not-offered" });
    expect([...none.calls.install, ...blocked.calls.install]).toEqual([]);
  });

  it("installs the store's latest version when none is named, once, and follows it to success", async () => {
    const { deps, calls } = setup({}, [step("running", 50), step("successful", 100)]);
    const reports: number[] = [];
    const outcome = await installStoreApp(
      deps,
      "pdi",
      "sn_ztsd",
      { version: null, demoData: false },
      LIVE,
      (p) => reports.push(p.percent),
      LIMITS,
    );
    expect(outcome).toEqual({
      state: "installed",
      name: "Zero Touch Service Desk",
      version: "3.3.3",
      progressId: "prog1",
      seconds: 10,
    });
    expect(calls.install).toEqual(["sn_ztsd 3.3.3"]);
    expect(reports).toEqual([0, 50]);
  });

  it("installs the version named", async () => {
    const { deps, calls } = setup({}, [step("successful", 100)]);
    await installStoreApp(
      deps,
      "pdi",
      "sn_ztsd",
      { version: "3.2.0", demoData: false },
      LIVE,
      () => {},
      LIMITS,
    );
    expect(calls.install).toEqual(["sn_ztsd 3.2.0"]);
  });

  it("asks for the application's demo data only when told to (ADR-0048)", async () => {
    const { deps, calls } = setup({}, [step("successful", 100)]);
    await installStoreApp(
      deps,
      "pdi",
      "sn_ztsd",
      { version: null, demoData: true },
      LIVE,
      () => {},
      LIMITS,
    );
    expect(calls.install).toEqual(["sn_ztsd 3.3.3 with demo data"]);
  });

  it("reports a failure the instance states", async () => {
    const { deps } = setup({}, [step("failed", 100, { error: "Unable to download app package" })]);
    await expect(
      installStoreApp(
        deps,
        "pdi",
        "sn_ztsd",
        { version: null, demoData: false },
        LIVE,
        () => {},
        LIMITS,
      ),
    ).rejects.toMatchObject({
      code: "store-app-install-failed",
      message: expect.stringContaining("Unable to download app package"),
    });
  });

  it("calls the outcome unknown, and does not retry, when the start's answer is lost", async () => {
    const { deps, calls } = setup({}, [], new InstanceError("socket hang up"));
    await expect(
      installStoreApp(
        deps,
        "pdi",
        "sn_ztsd",
        { version: null, demoData: false },
        LIVE,
        () => {},
        LIMITS,
      ),
    ).rejects.toMatchObject({ code: "store-app-install-state-unknown" });
    expect(calls.install).toHaveLength(1);
  });

  it("stops waiting after the time limit, naming the progress to check", async () => {
    const { deps } = setup({}, []);
    await expect(
      installStoreApp(
        deps,
        "pdi",
        "sn_ztsd",
        { version: null, demoData: false },
        LIVE,
        () => {},
        LIMITS,
      ),
    ).rejects.toMatchObject({
      code: "store-app-install-state-unknown",
      hint: expect.stringContaining("prog1"),
    });
  });
});
