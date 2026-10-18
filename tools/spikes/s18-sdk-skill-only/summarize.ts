// Spike S18: one line per run (cost, time, live queries, builds, installs) and each turn's reply.
//   bun tools/spikes/s18-sdk-skill-only/summarize.ts <out dir> [--replies]
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface TurnFacts {
  cost: number;
  ms: number;
  commands: string[];
  edits: string[];
  skill: boolean;
  reply: string;
}

type StreamEvent = Record<string, unknown>;

function events(stream: string): StreamEvent[] {
  return stream.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as StreamEvent];
    } catch {
      return [];
    }
  });
}

function recordToolUse(out: TurnFacts, item: StreamEvent): void {
  const input = item["input"] as Record<string, string>;
  if (item["name"] === "Bash") out.commands.push(input["command"] ?? "");
  if (item["name"] === "Write" || item["name"] === "Edit") out.edits.push(input["file_path"] ?? "");
  if (item["name"] === "Skill") out.skill = true;
}

function facts(stream: string): TurnFacts {
  const out: TurnFacts = { cost: 0, ms: 0, commands: [], edits: [], skill: false, reply: "" };
  for (const event of events(stream)) {
    if (event["type"] === "assistant") {
      const content = (event["message"] as { content: StreamEvent[] }).content;
      for (const item of content.filter((c) => c["type"] === "tool_use")) recordToolUse(out, item);
    }
    if (event["type"] === "result") {
      out.cost = Number(event["total_cost_usd"] ?? 0);
      out.ms = Number(event["duration_ms"] ?? 0);
      out.reply = String(event["result"] ?? "");
    }
  }
  return out;
}

const count = (commands: string[], pattern: RegExp) =>
  commands.reduce((n, c) => n + (c.match(new RegExp(pattern.source, "g"))?.length ?? 0), 0);

const [outDir = "s18-runs", flag] = process.argv.slice(2);
const runs = (await readdir(outDir)).sort();
console.log(
  "run | turns | cost $ | minutes | skill | queries | explain | build | install | transform/download | files written",
);
for (const run of runs) {
  const names = (await readdir(join(outDir, run)))
    .filter((f) => /^turn-\d+\.jsonl$/.test(f))
    .sort();
  const turns = await Promise.all(
    names.map(async (f) => facts(await readFile(join(outDir, run, f), "utf8"))),
  );
  const commands = turns.flatMap((t) => t.commands);
  const row = [
    run,
    turns.length,
    turns.reduce((s, t) => s + t.cost, 0).toFixed(2),
    (turns.reduce((s, t) => s + t.ms, 0) / 60000).toFixed(1),
    turns.some((t) => t.skill) ? "yes" : "no",
    count(commands, /sdk(@[\d.]+)? query /),
    count(commands, /sdk(@[\d.]+)? explain /),
    count(commands, /sdk(@[\d.]+)? build|run build/),
    count(commands, /sdk(@[\d.]+)? (install|deploy)|run deploy/),
    count(commands, /sdk(@[\d.]+)? (transform|download)/),
    new Set(turns.flatMap((t) => t.edits)).size,
  ];
  console.log(row.join(" | "));
  if (flag === "--replies") {
    for (const [index, turn] of turns.entries())
      console.log(`\n--- ${run} turn ${index}\n${turn.reply}\n`);
  }
}
