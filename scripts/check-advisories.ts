// Fails when `bun audit` reports an advisory the register doesn't record, or one past its review
// date (spec 012, step 2). Run from the repository root: bun scripts/check-advisories.ts
import { readFileSync } from "node:fs";
import { compareAdvisories, parseAudit, parseRegister } from "./advisories";

const REGISTER = "docs/security/advisories.md";

// `bun audit` exits non-zero whenever it finds anything; the JSON on stdout is what counts.
const audit = Bun.spawnSync(["bun", "audit", "--json"], { stdout: "pipe", stderr: "inherit" });
const output = audit.stdout.toString().trim();
const today = new Date().toISOString().slice(0, 10);
const result = compareAdvisories(
  parseAudit(output === "" ? "{}" : output),
  parseRegister(readFileSync(REGISTER, "utf8")),
  today,
);

for (const entry of result.resolved) {
  console.log(`no longer reported, remove from ${REGISTER}: ${entry.id} (${entry.pkg})`);
}
for (const a of result.unrecorded) {
  console.error(`new advisory: ${a.id} ${a.severity} ${a.pkg}: ${a.title}`);
}
for (const a of result.expired) {
  console.error(`past its review date in ${REGISTER}: ${a.id} ${a.pkg}`);
}
if (result.unrecorded.length > 0 || result.expired.length > 0) {
  console.error(`fix or upgrade the package, or record a dated decision in ${REGISTER}`);
  process.exit(1);
}
console.log(`advisories: every reported advisory has a decision in ${REGISTER} still in date`);
