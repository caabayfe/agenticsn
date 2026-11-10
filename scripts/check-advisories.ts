// Fails when `bun audit` reports an advisory the register doesn't record, one past its review
// date (spec 012, step 2), or one that now hits an installed version or arrives through a direct
// dependency its decision doesn't name (spec 014, F2). Run from the repository root:
// bun scripts/check-advisories.ts
import { readFileSync } from "node:fs";
import {
  compareAdvisories,
  type Difference,
  findingsOf,
  parseAudit,
  parseRegister,
} from "./advisories";
import { parseLockfile } from "./lockfile";

const REGISTER = "docs/security/advisories.md";

// `bun audit` exits non-zero whenever it finds anything; the JSON on stdout is what counts.
const audit = Bun.spawnSync(["bun", "audit", "--json"], { stdout: "pipe", stderr: "inherit" });
const output = audit.stdout.toString().trim();
const today = new Date().toISOString().slice(0, 10);
const lock = parseLockfile(readFileSync("bun.lock", "utf8"));
const result = compareAdvisories(
  findingsOf(parseAudit(output === "" ? "{}" : output), lock),
  parseRegister(readFileSync(REGISTER, "utf8")),
  today,
);

function described(difference: Difference): string {
  const parts = [];
  if (difference.versions.length > 0) parts.push(`version ${difference.versions.join(", ")}`);
  if (difference.through.length > 0) parts.push(`through ${difference.through.join(", ")}`);
  return `${difference.id} ${difference.pkg}: ${parts.join("; ")}`;
}

for (const entry of result.resolved) {
  console.log(`no longer reported, remove from ${REGISTER}: ${entry.id} (${entry.pkg})`);
}
for (const difference of result.narrower) {
  console.log(`the decision names what is no longer reported, narrow it: ${described(difference)}`);
}
for (const a of result.unrecorded) {
  console.error(
    `new advisory: ${a.id} ${a.severity} ${a.pkg} ${a.versions.join(", ")}: ${a.title}`,
  );
}
for (const difference of result.changed) {
  console.error(`now reported for what its decision doesn't cover: ${described(difference)}`);
}
for (const a of result.expired) {
  console.error(`past its review date in ${REGISTER}: ${a.id} ${a.pkg}`);
}
if (result.unrecorded.length + result.changed.length + result.expired.length > 0) {
  console.error(`fix or upgrade the package, or record a dated decision in ${REGISTER}`);
  process.exit(1);
}
console.log(`advisories: every reported advisory has a decision in ${REGISTER} still in date`);
