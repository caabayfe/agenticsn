// Bun version gate (spec 014, B1): coverage and compiled binaries differ between Bun patch
// releases, so `bun run verify` must run on the version CI and releases use. `.bun-version` is
// the single source of truth; the workflows read it through setup-bun's `bun-version-file`.
import { join } from "node:path";

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export function parseBunVersionFile(text: string): string {
  const version = text.trim();
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`.bun-version must hold one exact version such as 1.4.4, found "${version}"`);
  }
  return version;
}

export function bunVersionMismatch(expected: string, running: string): string | null {
  if (expected === running) {
    return null;
  }
  return (
    `Bun ${running} is running, but this repository builds and verifies with Bun ${expected} ` +
    `(.bun-version), so coverage and builds would not match CI. Install it with ` +
    `\`curl -fsSL https://bun.sh/install | bash -s bun-v${expected}\`.`
  );
}

if (import.meta.main) {
  const expected = parseBunVersionFile(await Bun.file(join(process.cwd(), ".bun-version")).text());
  const mismatch = bunVersionMismatch(expected, Bun.version);
  if (mismatch !== null) {
    console.error(mismatch);
    process.exit(1);
  }
  console.log(`bun version: ${Bun.version}`);
}
