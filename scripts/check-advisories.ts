// Fails when `bun audit` did not produce a valid report (SEC3-07, exit code 2). Fails with exit
// code 1 when it reports an advisory the register doesn't record, one past its review date
// (spec 012, step 2), or one that now hits an installed version or arrives through a direct
// dependency its decision doesn't name (spec 014, F2). Run from the repository root:
// bun scripts/check-advisories.ts
import { readFileSync } from "node:fs";
import { type Difference, parseRegister } from "./advisories";
import { advisoryGate } from "./advisory-gate";
import { parseLockfile } from "./lockfile";

const REGISTER = "docs/security/advisories.md";
// Apart from 1 (advisories that need a decision), so a job log shows which one happened.
const DID_NOT_RUN = 2;

const audit = Bun.spawnSync(["bun", "audit", "--json"], { stdout: "pipe", stderr: "inherit" });
const outcome = advisoryGate(
  { exitCode: audit.exitCode, stdout: audit.stdout.toString() },
  parseLockfile(readFileSync("bun.lock", "utf8")),
  parseRegister(readFileSync(REGISTER, "utf8")),
  new Date().toISOString().slice(0, 10),
);
if (outcome.kind === "not-run") {
  console.error(`the audit did not run: ${outcome.reason}`);
  console.error("nothing is known about advisories; fix the cause above and run it again");
  process.exit(DID_NOT_RUN);
}
const result = outcome.comparison;

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
if (outcome.failed) {
  console.error(`fix or upgrade the package, or record a dated decision in ${REGISTER}`);
  process.exit(1);
}
console.log(`advisories: every reported advisory has a decision in ${REGISTER} still in date`);
