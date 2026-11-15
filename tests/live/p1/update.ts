import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [root = ""] = process.argv.slice(2);
if (!root) throw new Error("acceptance workspace required");
const tag = "p1-accept-pdi11-20261114";
const binary = resolve(import.meta.dir, "../../../dist/snagentic");
const definition = join(root, "source/global/src/fluent/acceptance.now.ts");
const script = join(root, "source/global/src/fluent/scripts/calculate.js");
const before = readFileSync(definition, "utf8");
if (!before.includes("threshold: '70'") || !before.includes(`name: '${tag} subflow'`))
  throw new Error("source already changed");
writeFileSync(
  definition,
  before
    .replace("threshold: '70'", "threshold: '71'")
    .replace(`name: '${tag} subflow'`, `name: '${tag} subflow verified'`),
);
const code = readFileSync(script, "utf8");
if (!code.includes("threshold * 2")) throw new Error("script already changed");
writeFileSync(script, code.replace("threshold * 2", "threshold * 3"));
async function run(args: readonly string[]) {
  const child = Bun.spawn([...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr || stdout}`);
  return stdout;
}
await run([binary, "fluent-keys", "source/global", "--workspace", root, "--format", "json"]);
await run(["git", "add", "--", "source/global"]);
await run([
  "git",
  "-c",
  "user.name=snagentic acceptance",
  "-c",
  "user.email=acceptance@localhost",
  "commit",
  "-qm",
  "P1 acceptance changes script, subflow name and flow input",
]);
const plan = JSON.parse(
  await run([
    binary,
    "plan-push",
    "--workspace",
    root,
    "--instance",
    "pdi11",
    "--label",
    tag,
    "--format",
    "json",
  ]),
);
writeFileSync(join(root, "acceptance/update-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify(plan));
