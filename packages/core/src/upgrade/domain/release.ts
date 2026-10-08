import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { compareVersions } from "./version";

// The binary a release publishes for a platform (the release workflow's names), or null.
const ASSETS: Readonly<Record<string, string>> = {
  "darwin/arm64": "snagentic-macos-arm64",
  "linux/x64": "snagentic-linux-x64",
  "linux/arm64": "snagentic-linux-arm64",
  "win32/x64": "snagentic-windows-x64.exe",
};

export function assetName(platform: string, arch: string): string | null {
  return ASSETS[`${platform}/${arch}`] ?? null;
}

// A file's sum in SHA256SUMS (`<hex>  <name>` lines), or null when it is not listed.
export function expectedSum(sums: string, asset: string): string | null {
  for (const line of sums.split("\n")) {
    const [sum, name] = line.trim().split(/\s+\*?/);
    if (name === asset && sum !== undefined && /^[0-9a-f]{64}$/.test(sum)) {
      return sum;
    }
  }
  return null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export interface ReleaseNotes {
  readonly version: string;
  readonly notes: string;
}

// The `### ⚠️` sections (steps to take) of the releases after `from`, up to `to`, oldest first.
export function upgradeSteps(
  releases: readonly ReleaseNotes[],
  from: string,
  to: string,
): { readonly version: string; readonly sections: readonly string[] }[] {
  return releases
    .filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version))
    .map((r) => ({ version: r.version, sections: warnedSections(r.notes) }))
    .filter((r) => r.sections.length > 0);
}

function warnedSections(notes: string): string[] {
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of notes.split("\n")) {
    if (/^#{1,3} /.test(line)) {
      if (current !== null) {
        sections.push(current.join("\n").trim());
      }
      current = line.includes("⚠️") ? [line] : null;
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    sections.push(current.join("\n").trim());
  }
  return sections;
}
