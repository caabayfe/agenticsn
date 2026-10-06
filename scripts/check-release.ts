// Fails a release whose tag does not match the source version, or whose changelog has no
// section for it (release workflow).
import { readFileSync } from "node:fs";
import { VERSION } from "../packages/core/src/version";

const tag = process.argv[2] ?? "";
const problems: string[] = [];
if (tag !== `v${VERSION}`) {
  problems.push(
    `tag ${tag} does not match the source version v${VERSION} (packages/core/src/version.ts)`,
  );
}
for (const manifest of [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
]) {
  const version: unknown = JSON.parse(readFileSync(manifest, "utf8")).version;
  if (version !== undefined && version !== VERSION) {
    problems.push(`${manifest} says ${String(version)}, not ${VERSION}`);
  }
}
if (
  !new RegExp(`^## \\[?${VERSION.replaceAll(".", "\\.")}\\]?`, "m").test(
    readFileSync("CHANGELOG.md", "utf8"),
  )
) {
  problems.push(`CHANGELOG.md has no section for ${VERSION}`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`release v${VERSION}: tag, versions and changelog agree`);
