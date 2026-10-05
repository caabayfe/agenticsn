// Spike S4 (throwaway): can espree, the parser behind ESLint, parse real instance scripts?
//   bun tools/spikes/s4-parse-corpus/parse-corpus.ts <v1 metadata dir> <out.json>
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "espree";

const root = process.argv[2];
const out = process.argv[3];
if (root === undefined || out === undefined) {
  console.error("usage: parse-corpus.ts <metadata dir> <out.json>");
  process.exit(2);
}

function scriptFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "_children") {
      scriptFiles(path, found);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      found.push(path);
    }
  }
  return found;
}

type Outcome =
  | "parsed"
  | "parsed-with-global-return"
  | "function-expression"
  | "json"
  | "module"
  | "failed";

function tryParse(
  source: string,
  ecmaVersion: 5 | "latest",
  globalReturn: boolean,
  sourceType: "script" | "module" = "script",
): string | null {
  try {
    parse(source, { ecmaVersion, sourceType, ecmaFeatures: { globalReturn } });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function isJson(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

// Fallbacks for fields ServiceNow does not run as plain scripts.
function fallbackOutcome(source: string): Outcome {
  if (tryParse(source, "latest", true) === null) {
    return "parsed-with-global-return";
  }
  if (isJson(source)) {
    return "json";
  }
  if (tryParse(`(${source}\n)`, "latest", false) === null) {
    return "function-expression";
  }
  if (tryParse(source, "latest", false, "module") === null) {
    return "module";
  }
  return "failed";
}

// Strip positions and identifiers so similar errors group together.
function normalize(message: string): string {
  return message.replace(/'[^']*'/g, "'…'").replace(/\d+/g, "N");
}

const started = performance.now();
const files = scriptFiles(root);
const byField: Record<string, { total: number; failed: number; fallback: number }> = {};
const residual: { file: string; error: string; firstLines: string }[] = [];
const errors: Record<string, number> = {};
const totals: Record<Outcome, number> = {
  parsed: 0,
  "parsed-with-global-return": 0,
  "function-expression": 0,
  json: 0,
  module: 0,
  failed: 0,
};
let es5Compatible = 0;
let emptyFiles = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (source.trim() === "") {
    emptyFiles += 1;
  }
  const tableName = basename(dirname(dirname(file)));
  const key = `${tableName}.${basename(file, ".js")}`;
  const bucket = byField[key] ?? { total: 0, failed: 0, fallback: 0 };
  byField[key] = bucket;
  bucket.total += 1;

  const firstError = tryParse(source, "latest", false);
  const outcome: Outcome = firstError === null ? "parsed" : fallbackOutcome(source);
  if (outcome === "failed" && firstError !== null) {
    bucket.failed += 1;
    const normalized = normalize(firstError);
    errors[normalized] = (errors[normalized] ?? 0) + 1;
    residual.push({
      file: file.slice(root.length + 1),
      error: firstError,
      firstLines: source.split("\n").slice(0, 3).join(" / ").slice(0, 160),
    });
  } else if (outcome !== "parsed") {
    bucket.fallback += 1;
  }
  totals[outcome] += 1;
  if (outcome === "parsed" && tryParse(source, 5, false) === null) {
    es5Compatible += 1;
  }
}

const failingFields = Object.entries(byField)
  .filter(([, bucket]) => bucket.failed > 0)
  .sort(([, left], [, right]) => right.failed - left.failed)
  .map(([field, bucket]) => ({ field, ...bucket }));

const report = {
  spike: "S4",
  files: files.length,
  emptyFiles,
  seconds: Math.round((performance.now() - started) / 100) / 10,
  totals,
  failureRate: Math.round((totals.failed / files.length) * 10000) / 100,
  es5Compatible,
  fieldsNeedingFallback: Object.entries(byField)
    .filter(([, bucket]) => bucket.fallback > 0)
    .sort(([, left], [, right]) => right.fallback - left.fallback)
    .map(([field, bucket]) => `${field} (${bucket.fallback}/${bucket.total})`),
  failingFields: failingFields.map(({ field, total, failed }) => ({ field, total, failed })),
  residual,
  topErrors: Object.entries(errors)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 15),
};
await Bun.write(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, residual: residual.length }, null, 2));
