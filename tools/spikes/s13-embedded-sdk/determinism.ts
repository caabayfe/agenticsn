// Spike S13, test A4: builds from the binary are deterministic after normalization, equal the
// CLI's, and every meaningful source edit changes the digest.
//   bun determinism.ts <binary> <project dir> <CLI reference dist dir>
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digest } from "./normalize";

const binary = resolve(process.argv[2] ?? "./embed-bin");
const project = resolve(process.argv[3] ?? ".");
const reference = resolve(process.argv[4] ?? "./ref");
const work = mkdtempSync(join(tmpdir(), "s13-a4-"));
const SOURCE = "src/fluent/s11-flow.now.ts";

async function build(name: string, edit?: [string, string]): Promise<string> {
  const dir = join(work, name);
  cpSync(project, dir, { recursive: true, filter: (p) => !p.includes("node_modules") });
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  if (edit) {
    const file = join(dir, SOURCE);
    const text = readFileSync(file, "utf8");
    if (!text.includes(edit[0])) throw new Error(`edit target not found: ${edit[0]}`);
    writeFileSync(file, text.replace(edit[0], edit[1]));
  }
  const run = Bun.spawn([binary, dir], { stdout: "pipe", stderr: "pipe", env: process.env });
  const out = await new Response(run.stdout).text();
  if ((await run.exited) !== 0 || !out.includes("success: true")) {
    return `build failed: ${out.trim().split("\n").slice(-1)[0]}`;
  }
  return digest(join(dir, "dist"));
}

const base = await build("one");
const again = await build("two");
const cli = digest(reference);
console.log(`two builds equal: ${base === again}`);
console.log(`binary equals CLI: ${base === cli}  (${base.slice(0, 12)} / ${cli.slice(0, 12)})`);

// Edits that change what is delivered must change the digest; each must differ from the others.
const meaningful: Record<string, [string, string]> = {
  "action value (gzipped values)": ["S11 flow ran (v5)", "S11 flow ran (v6)"],
  "trigger condition (gzipped trigger_inputs)": ["STARTSWITHS11'", "STARTSWITHS12'"],
  "flow name": ["name: 'snagentic spike S11 flow'", "name: 'snagentic spike S11 flow 2'"],
  "run as": ["runAs: 'system'", "runAs: 'user'"],
  "trigger type": ["trigger.record.created", "trigger.record.updated"],
  "action $id (sys_id)": ["Now.ID['s11_update']", "Now.ID['s11_update_2']"],
};
// Edits that change nothing delivered: reported, not required either way.
const cosmetic: Record<string, [string, string]> = {
  comment: ["// Spike S11:", "// Spike S11 (edited comment):"],
  whitespace: ["        runAs: 'system',", "        runAs:   'system',"],
};

const seen = new Set([base]);
let pass = base === again && base === cli;
for (const [label, edit] of Object.entries(meaningful)) {
  const d = await build(label.replace(/\W+/g, "-"), edit);
  const changed = !d.startsWith("build failed") && !seen.has(d);
  pass &&= changed;
  seen.add(d);
  console.log(`${changed ? "changed " : "NOT CHANGED"}  ${label}  ${d.slice(0, 12)}`);
}
for (const [label, edit] of Object.entries(cosmetic)) {
  const d = await build(label, edit);
  console.log(`${d === base ? "same    " : "changed "}  ${label} (cosmetic)  ${d.slice(0, 12)}`);
}
console.log(`A4 (one machine): ${pass ? "pass" : "FAIL"}`);
rmSync(work, { recursive: true, force: true });
