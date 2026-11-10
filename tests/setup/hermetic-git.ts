import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test preload (bunfig.toml): every git the tests start, directly or through product code,
// reads only the repository's own configuration (spec 014, R1). Without this a developer's or
// runner's global configuration (safe.bareRepository=explicit, commit signing, a default branch
// name) changes the results. An empty file, not /dev/null, so it works on Windows too. Tests
// that commit name their identity with `-c user.name=... -c user.email=...`; product code falls
// back to its own identity when none is configured.
const directory = mkdtempSync(join(tmpdir(), "snagentic-test-git-"));
const emptyConfig = join(directory, "gitconfig");
writeFileSync(emptyConfig, "");

process.env["GIT_CONFIG_GLOBAL"] = emptyConfig;
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
for (const name of Object.keys(process.env)) {
  if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(name)) delete process.env[name];
}
