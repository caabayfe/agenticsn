import { describe, expect, it } from "bun:test";
import {
  type ReleaseInfo,
  sha256Hex,
  type UpdateCheck,
  type UpgradeDependencies,
  updateNotice,
  upgrade,
} from "@snagentic/core";

const signal = new AbortController().signal;
const NEW_BINARY = new TextEncoder().encode("snagentic 1.3.0 binary");
const ASSET = "snagentic-macos-arm64";

const RELEASES: ReleaseInfo[] = [
  { version: "1.3.0", notes: "### ⚠️ Changed: run snagentic agent install\n\nThe pack moved." },
  { version: "1.2.1", notes: "### Fixed\n\n- integrate" },
];

function setup(overrides: Partial<UpgradeDependencies> = {}) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const deps: UpgradeDependencies = {
    releases: {
      latest: async () => RELEASES[0] ?? { version: "0.0.0", notes: "" },
      list: async () => RELEASES,
      download: async (version, asset) => {
        calls.push(`download ${version} ${asset}`);
        return { binary: NEW_BINARY, sums: `${sha256Hex(NEW_BINARY)}  ${ASSET}\n` };
      },
    },
    binary: {
      path: "/usr/local/bin/snagentic",
      replace: async (_binary, version) => {
        calls.push(`replace ${version}`);
      },
      run: async (args, cwd) => {
        calls.push(`run ${args.join(" ")} in ${cwd}`);
        const files = [
          { path: "AGENTS.md", status: "updated" },
          { path: ".mcp.json", status: "unchanged" },
        ];
        return { exitCode: 0, stdout: JSON.stringify({ files }), stderr: "" };
      },
    },
    workspaceFiles: {
      read: async (path) => files.get(path) ?? null,
      write: async () => {},
    },
    current: "1.2.1",
    platform: "darwin",
    arch: "arm64",
    signal,
    ...overrides,
  };
  return { deps, calls, files };
}

describe("upgrade", () => {
  it("installs the latest release after checking its sum, and lists the steps it skipped", async () => {
    const { deps, calls } = setup();
    expect(await upgrade(deps, {})).toEqual({
      status: "upgraded",
      from: "1.2.1",
      to: "1.3.0",
      steps: [
        {
          version: "1.3.0",
          sections: ["### ⚠️ Changed: run snagentic agent install\n\nThe pack moved."],
        },
      ],
      pack: [],
    });
    expect(calls).toEqual([`download 1.3.0 ${ASSET}`, "replace 1.3.0"]);
  });

  it("does nothing when already on the latest release", async () => {
    const { deps, calls } = setup({ current: "1.3.0" });
    expect(await upgrade(deps, {})).toEqual({ status: "up-to-date", version: "1.3.0" });
    expect(calls).toEqual([]);
  });

  it("installs a requested version, also an older one", async () => {
    const { deps, calls } = setup({ current: "1.3.0" });
    expect(await upgrade(deps, { version: "v1.2.1" })).toMatchObject({
      status: "upgraded",
      to: "1.2.1",
      steps: [],
    });
    expect(calls).toContain("replace 1.2.1");
    await expect(upgrade(deps, { version: "latest-ish" })).rejects.toMatchObject({
      code: "release-unavailable",
    });
  });

  it("refuses a binary that does not match SHA256SUMS, replacing nothing", async () => {
    const { deps, calls } = setup();
    const tampered = {
      ...deps.releases,
      download: async () => ({ binary: NEW_BINARY, sums: `${"0".repeat(64)}  ${ASSET}\n` }),
    };
    await expect(upgrade({ ...deps, releases: tampered }, {})).rejects.toMatchObject({
      code: "checksum-mismatch",
    });
    const unlisted = { ...deps.releases, download: async () => ({ binary: NEW_BINARY, sums: "" }) };
    await expect(upgrade({ ...deps, releases: unlisted }, {})).rejects.toMatchObject({
      code: "checksum-mismatch",
    });
    expect(calls.filter((c) => c.startsWith("replace"))).toEqual([]);
  });

  it("refuses when running from source, or on a platform without a build", async () => {
    const { deps } = setup();
    await expect(
      upgrade({ ...deps, binary: { ...deps.binary, path: null } }, {}),
    ).rejects.toMatchObject({ code: "not-an-installed-binary" });
    await expect(upgrade({ ...deps, arch: "x64" }, {})).rejects.toMatchObject({
      code: "no-build-for-platform",
    });
  });

  it("refreshes the workspace's agent pack with the new binary, listing what changed", async () => {
    const { deps, calls, files } = setup();
    files.set("/w/AGENTS.md", "<!-- snagentic:begin 1.2.1 -->\nrules\n<!-- snagentic:end -->\n");
    const result = await upgrade(deps, { workspace: "/w" });
    expect(result).toMatchObject({ status: "upgraded", pack: ["AGENTS.md"] });
    expect(calls.at(-1)).toBe("run agent install --format json in /w");
    const garbled = setup();
    garbled.files.set("/w/AGENTS.md", "<!-- snagentic:begin 1.2.1 -->\n<!-- snagentic:end -->\n");
    const failing = {
      ...garbled.deps.binary,
      run: async () => ({ exitCode: 1, stdout: "not json", stderr: "boom" }),
    };
    expect(await upgrade({ ...garbled.deps, binary: failing }, { workspace: "/w" })).toMatchObject({
      status: "upgraded",
      pack: [],
    });
    const noPack = setup();
    expect(await upgrade(noPack.deps, { workspace: "/w" })).toMatchObject({ pack: [] });
    expect(noPack.calls.some((c) => c.startsWith("run"))).toBe(false);
  });
});

describe("updateNotice", () => {
  function store(initial: UpdateCheck | null) {
    const state = { value: initial, lookups: 0 };
    return {
      state,
      deps: (latest: () => Promise<ReleaseInfo>, now = "2026-10-08T12:00:00Z") => ({
        releases: {
          latest: async () => {
            state.lookups += 1;
            return latest();
          },
          list: async () => [],
          download: async () => ({ binary: new Uint8Array(), sums: "" }),
        },
        store: {
          read: async () => state.value,
          write: async (check: UpdateCheck) => {
            state.value = check;
          },
        },
        current: "1.2.1",
        now: () => new Date(now),
        signal,
      }),
    };
  }
  const newer = async () => ({ version: "1.3.0", notes: "" });

  it("names a newer release, asking GitHub at most once a day", async () => {
    const s = store(null);
    expect(await updateNotice(s.deps(newer))).toBe(
      "snagentic 1.3.0 is available: run snagentic upgrade",
    );
    expect(await updateNotice(s.deps(newer, "2026-10-08T18:00:00Z"))).toBe(
      "snagentic 1.3.0 is available: run snagentic upgrade",
    );
    expect(s.state.lookups).toBe(1);
  });

  it("says nothing when current, or when GitHub cannot be reached, and waits a day", async () => {
    expect(
      await updateNotice(store(null).deps(async () => ({ version: "1.2.1", notes: "" }))),
    ).toBeNull();
    const offline = store(null);
    const fail = async (): Promise<ReleaseInfo> => {
      throw new Error("offline");
    };
    expect(await updateNotice(offline.deps(fail))).toBeNull();
    expect(offline.state.value).toEqual({ checkedAt: "2026-10-08T12:00:00.000Z", latest: null });
    await updateNotice(offline.deps(fail, "2026-10-08T13:00:00Z"));
    expect(offline.state.lookups).toBe(1);
  });
});
