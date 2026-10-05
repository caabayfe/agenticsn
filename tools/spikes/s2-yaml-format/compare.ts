// Spike S2 (throwaway): reading and writing v1 YAML mirrors from TypeScript.
//   bun tools/spikes/s2-yaml-format/compare.ts <v1 metadata dir> <out.json>
// (a) reader parity: recompute every record hash from files and compare with _meta.yaml
// (b) writer byte parity: re-emit record.yaml and compare with v1's (libyaml) bytes
// (c) own style: does the proposed style round-trip every value, including edge cases?
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { canonicalText, recordHash } from "../../../packages/core/src/index";

const root = process.argv[2];
const out = process.argv[3];
if (root === undefined || out === undefined) {
  console.error("usage: compare.ts <metadata dir> <out.json>");
  process.exit(2);
}

function recordDirectories(directory: string, found: string[] = []): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "_meta.yaml")) {
    found.push(directory);
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "_children") {
      recordDirectories(join(directory, entry.name), found);
    }
  }
  return found;
}

// record.yaml holds only strings, so every scalar is read as text (failsafe schema).
function readValues(yamlText: string): Record<string, string> {
  const data: unknown = parse(yamlText, { schema: "failsafe" });
  if (data === null || typeof data !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

const V1_LIKE = {
  sortMapEntries: true,
  lineWidth: 100,
  minContentWidth: 0,
  singleQuote: true,
  defaultStringType: "PLAIN",
  defaultKeyType: "PLAIN",
} as const;

const OWN_STYLE = {
  sortMapEntries: true,
  lineWidth: 0,
  singleQuote: true,
  blockQuote: "literal",
  defaultStringType: "PLAIN",
  defaultKeyType: "PLAIN",
} as const;

function roundTrips(values: Record<string, string>): boolean {
  const reread = readValues(stringify(values, OWN_STYLE));
  const keys = Object.keys(values);
  return (
    keys.length === Object.keys(reread).length && keys.every((key) => reread[key] === values[key])
  );
}

const started = performance.now();
const directories = recordDirectories(root);
let hashMatches = 0;
const hashMismatches: string[] = [];
let byteIdentical = 0;
let ownStyleRoundTrips = 0;
const ownStyleFailures: string[] = [];
const mismatchKinds: Record<string, number> = {};
let v1Bytes = 0;
let ownStyleBytes = 0;
let ownStyleIdenticalToV1 = 0;
let multiLineRecords = 0;

for (const directory of directories) {
  const meta: { hash?: string; sys_class_name?: string; files?: Record<string, string> } =
    parse(readFileSync(join(directory, "_meta.yaml"), "utf8")) ?? {};
  const recordPath = join(directory, "record.yaml");
  const recordText = statSync(recordPath, { throwIfNoEntry: false })
    ? readFileSync(recordPath, "utf8")
    : "";
  const plain = readValues(recordText);
  const values: Record<string, string> = { ...plain };
  for (const [field, file] of Object.entries(meta.files ?? {})) {
    const path = join(directory, file);
    values[field] = statSync(path, { throwIfNoEntry: false })
      ? canonicalText(readFileSync(path, "utf8"))
      : "";
  }
  if (recordHash(meta.sys_class_name ?? "", values) === meta.hash) {
    hashMatches += 1;
  } else if (hashMismatches.length < 20) {
    hashMismatches.push(directory);
  }

  const reEmitted = Object.keys(plain).length === 0 ? "{}\n" : stringify(plain, V1_LIKE);
  if (reEmitted === recordText) {
    byteIdentical += 1;
  } else {
    const kind = Object.values(plain).some((value) => /[\n\r]/.test(value))
      ? "multi-line value"
      : Object.values(plain).some((value) => /[^\x20-\x7e]/.test(value))
        ? "non-ASCII value"
        : Object.values(plain).some((value) => value.length > 80)
          ? "long value (wrapping)"
          : "other quoting";
    mismatchKinds[kind] = (mismatchKinds[kind] ?? 0) + 1;
  }

  if (roundTrips(plain)) {
    ownStyleRoundTrips += 1;
  } else if (ownStyleFailures.length < 20) {
    ownStyleFailures.push(directory);
  }
  v1Bytes += recordText.length;
  const ownStyleText = Object.keys(plain).length === 0 ? "{}\n" : stringify(plain, OWN_STYLE);
  ownStyleBytes += ownStyleText.length;
  if (ownStyleText === recordText) {
    ownStyleIdenticalToV1 += 1;
  }
  if (Object.values(plain).some((value) => value.includes("\n"))) {
    multiLineRecords += 1;
  }
}

const adversarial: Record<string, string> = {
  yes: "yes",
  no: "no",
  on: "on",
  off: "Off",
  nullWord: "null",
  tilde: "~",
  empty: "",
  octal: "0123",
  octal12: "0o17",
  hex: "0x1F",
  exponent: "1e3",
  infinity: ".inf",
  date: "2024-01-01",
  timestamp: "2024-01-01 10:00:00",
  leadingSpace: " x",
  trailingSpace: "x ",
  tab: "\tx",
  crlf: "a\r\nb",
  cr: "a\rb",
  trailingNewline: "line\n",
  twoTrailing: "line\n\n",
  onlyNewlines: "\n\n",
  indentedSecondLine: "a\n  b",
  comment: "# x",
  dash: "- x",
  colon: "a: b",
  question: "? x",
  at: "@x",
  backtick: "`x",
  brace: "{x}",
  bracket: "[x]",
  percent: "%x",
  bang: "!x",
  ampersand: "&x",
  star: "*x",
  pipe: "| x",
  greater: "> x",
  quote: "'x\"",
  backslash: "a\\b",
  unicode: "Café 中文",
  emoji: "😀",
  lineSeparator: "a b",
  del: "a\u007fb",
  control: "a\u0001b",
  bom: "﻿x",
  nbsp: "a ",
  long: "x".repeat(500),
  longWords: "word ".repeat(100).trim(),
  spacesOnly: "   ",
  documentEnd: "...",
  documentStart: "---",
};
const adversarialFailures = Object.keys(adversarial).filter(
  (key) => !roundTrips({ [key]: adversarial[key] ?? "" }),
);

const report = {
  spike: "S2",
  records: directories.length,
  seconds: Math.round((performance.now() - started) / 100) / 10,
  readerHashMatches: hashMatches,
  readerHashMismatchSamples: hashMismatches,
  writerByteIdentical: byteIdentical,
  writerMismatchKinds: mismatchKinds,
  ownStyleRoundTrips,
  ownStyleIdenticalToV1,
  ownStyleFailureSamples: ownStyleFailures,
  adversarialCases: Object.keys(adversarial).length,
  adversarialFailures,
  recordsWithMultiLineValues: multiLineRecords,
  v1Megabytes: Math.round(v1Bytes / 1e5) / 10,
  ownStyleMegabytes: Math.round(ownStyleBytes / 1e5) / 10,
};
await Bun.write(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
