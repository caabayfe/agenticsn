// Explicitly invoked live acceptance setup. No instance write: builds source and saves a plan.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../..");
const binary = join(repository, "dist/snagentic");
const [profileWorkspace = "", root = "", tag = ""] = process.argv.slice(2);
if (!profileWorkspace || !root || !tag)
  throw new Error("profile workspace, new workspace and tag required");

async function command(args: readonly string[]) {
  const child = Bun.spawn([...args], { cwd: repository, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr || stdout}`);
  return stdout;
}

const run = (...args: string[]) =>
  command([binary, ...args, "--workspace", root, "--format", "json"]);
await command([binary, "init", root, "--format", "json"]);
mkdirSync(join(root, "instances/pdi11"), { recursive: true });
cpSync(
  join(profileWorkspace, "instances/pdi11/instance.yaml"),
  join(root, "instances/pdi11/instance.yaml"),
);
const neverCreated = crypto.randomUUID().replaceAll("-", "");
const files = new Map([
  [
    "acceptance.now.ts",
    readFileSync(join(repository, "tests/fixtures/p1-delivery/acceptance.now.ts"), "utf8")
      .replaceAll("P1_ACCEPT_TAG", tag)
      .replaceAll("P1_NEVER_CREATED_ID", neverCreated),
  ],
  [
    "scripts/calculate.js",
    readFileSync(join(repository, "tests/fixtures/p1-delivery/calculate.js"), "utf8"),
  ],
]);
for (const [file, content] of files) {
  const path = join(root, "source/global/src/fluent", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
const keys = await run("fluent-keys", "source/global");
console.log(keys.trim());
await command(["git", "-C", root, "add", "-A"]);
await command([
  "git",
  "-C",
  root,
  "-c",
  "user.name=snagentic acceptance",
  "-c",
  "user.email=acceptance@localhost",
  "commit",
  "-qm",
  "P1 live acceptance source",
]);
const result = JSON.parse(await run("plan-push", "--instance", "pdi11", "--label", tag));
mkdirSync(join(root, "acceptance"), { recursive: true });
writeFileSync(join(root, "acceptance/initial-plan.json"), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(
  join(root, "acceptance/run.json"),
  `${JSON.stringify({ tag, root, neverCreated }, null, 2)}\n`,
);
console.log(JSON.stringify({ root, tag, plan: result }));
