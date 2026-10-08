import { installedPackVersion } from "../../workspace/domain/agent-pack";
import type { WorkspaceFiles } from "../../workspace/ports";
import {
  ChecksumMismatchError,
  NoBuildForPlatformError,
  NotAnInstalledBinaryError,
  ReleaseUnavailableError,
} from "../domain/errors";
import { assetName, expectedSum, sha256Hex, upgradeSteps } from "../domain/release";
import { compareVersions, parseVersion } from "../domain/version";
import type { InstalledBinary, ReleaseSource } from "../ports";

export interface UpgradeDependencies {
  readonly releases: ReleaseSource;
  readonly binary: InstalledBinary;
  readonly workspaceFiles: WorkspaceFiles;
  readonly current: string;
  readonly platform: string;
  readonly arch: string;
  readonly signal: AbortSignal;
}

export interface UpgradeQuery {
  // A version to install (also an older one); default: the latest release.
  readonly version?: string;
  // The workspace it runs in, if any: its agent pack is refreshed.
  readonly workspace?: string;
}

export type UpgradeResult =
  | { readonly status: "up-to-date"; readonly version: string }
  | {
      readonly status: "upgraded";
      readonly from: string;
      readonly to: string;
      readonly steps: readonly { readonly version: string; readonly sections: readonly string[] }[];
      // Files the new agent pack changed in the workspace, to commit.
      readonly pack: readonly string[];
    };

async function target(deps: UpgradeDependencies, requested: string | undefined) {
  if (requested === undefined) {
    return (await deps.releases.latest(deps.signal)).version;
  }
  const version = parseVersion(requested);
  if (version === null) {
    throw new ReleaseUnavailableError(`version ${requested}`, "it is not a version like 1.2.3");
  }
  return version;
}

// The new agent pack's changed files, written by the new binary (it holds the new pack).
async function refreshPack(deps: UpgradeDependencies, root: string | undefined) {
  if (root === undefined) {
    return [];
  }
  if (installedPackVersion(await deps.workspaceFiles.read(`${root}/AGENTS.md`)) === null) {
    return [];
  }
  const ran = await deps.binary.run(["agent", "install", "--format", "json"], root);
  try {
    const files: unknown = JSON.parse(ran.stdout).files;
    return Array.isArray(files)
      ? files.filter((f) => f.status !== "unchanged").map((f) => String(f.path))
      : [];
  } catch {
    return [];
  }
}

// `snagentic upgrade` (ADR-0023): replaces the running binary with a release, checked against
// its SHA256SUMS, then refreshes the workspace's agent pack and lists the upgrade steps.
export async function upgrade(
  deps: UpgradeDependencies,
  query: UpgradeQuery,
): Promise<UpgradeResult> {
  if (deps.binary.path === null) {
    throw new NotAnInstalledBinaryError();
  }
  const asset = assetName(deps.platform, deps.arch);
  if (asset === null) {
    throw new NoBuildForPlatformError(deps.platform, deps.arch);
  }
  const to = await target(deps, query.version);
  if (query.version === undefined ? compareVersions(to, deps.current) <= 0 : to === deps.current) {
    return { status: "up-to-date", version: deps.current };
  }
  const { binary, sums } = await deps.releases.download(to, asset, deps.signal);
  if (expectedSum(sums, asset) !== sha256Hex(binary)) {
    throw new ChecksumMismatchError(asset, to);
  }
  await deps.binary.replace(binary, to);
  const steps = upgradeSteps(await deps.releases.list(deps.signal), deps.current, to);
  return {
    status: "upgraded",
    from: deps.current,
    to,
    steps,
    pack: await refreshPack(deps, query.workspace),
  };
}
