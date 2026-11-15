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
import type { InstalledBinary, Provenance, ProvenanceVerifier, ReleaseSource } from "../ports";

export interface UpgradeDependencies {
  readonly releases: ReleaseSource;
  readonly binary: InstalledBinary;
  readonly provenance: ProvenanceVerifier;
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
  readonly userHome?: string;
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
      readonly packWarning?: string;
      readonly provenance: Provenance;
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

interface PackRefresh {
  readonly pack: readonly string[];
  readonly packWarning?: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const REFRESH_WARNING =
  "The binary was upgraded, but agent integration needs attention; run snagentic agent install and review skipped paths.";

function refreshedFiles(text: string): PackRefresh {
  const output: unknown = JSON.parse(text);
  const files = record(output) ? output["files"] : null;
  if (
    !Array.isArray(files) ||
    !files.every(
      (file: unknown) =>
        record(file) && typeof file["path"] === "string" && typeof file["status"] === "string",
    )
  )
    return { pack: [], packWarning: REFRESH_WARNING };
  return {
    pack: files
      .filter((file) => ["created", "updated", "removed"].includes(file.status))
      .map((file) => String(file.path)),
    ...(files.some((file) => file.status === "skipped") ? { packWarning: REFRESH_WARNING } : {}),
  };
}

// The new agent pack's changed files, written by the new binary (it holds the new pack).
async function refreshPack(deps: UpgradeDependencies, query: UpgradeQuery): Promise<PackRefresh> {
  const installed =
    query.workspace !== undefined &&
    installedPackVersion(await deps.workspaceFiles.read(`${query.workspace}/AGENTS.md`)) !== null;
  const root = installed ? query.workspace : query.userHome;
  if (root === undefined) {
    return { pack: [] };
  }
  try {
    const ran = await deps.binary.run(["agent", "install", "--format", "json"], root);
    return ran.exitCode === 0
      ? refreshedFiles(ran.stdout)
      : { pack: [], packWarning: REFRESH_WARNING };
  } catch {
    return { pack: [], packWarning: REFRESH_WARNING };
  }
}

// `snagentic upgrade` (ADR-0023): replaces the running binary with a release, checked against
// its SHA256SUMS and, where gh can, its build provenance (ADR-0043), then refreshes the workspace's agent pack and lists the upgrade steps.
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
  // Before replace, which runs the new binary.
  const provenance = await deps.provenance.verify(binary, to, deps.signal);
  await deps.binary.replace(binary, to);
  const steps = upgradeSteps(await deps.releases.list(deps.signal), deps.current, to);
  return {
    status: "upgraded",
    from: deps.current,
    to,
    steps,
    ...(await refreshPack(deps, query)),
    provenance,
  };
}
