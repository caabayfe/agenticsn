import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

// Fluent projects with the now-sdk CLI's build of each (tests/fixtures/fluent, flows test plan).
export const FLUENT_FIXTURES = resolve(import.meta.dir, "../../../../tests/fixtures/fluent");
export const FLUENT_ERRORS_FIXTURE = resolve(
  import.meta.dir,
  "../../../../tests/fixtures/fluent-errors/a9",
);
export const KEYS_FILE = join("src", "fluent", "generated", "keys.ts");

// A copy outside the repository, so no node_modules is reachable from it.
export function copyFixture(source: string): string {
  const target = join(mkdtempSync(join(tmpdir(), "fluent-fixture-")), "project");
  cpSync(source, target, {
    recursive: true,
    filter: (p) => !p.startsWith(join(source, "expected")),
  });
  return target;
}

const GZIPPED = /<([a-z_]+)>(H4sI[A-Za-z0-9+/=]+)<\/\1>/g;
const SBOM_NOISE = /\n\s*"(serialNumber|timestamp)": "[^"]*",?/g;

// Gzipped values compared as text (gzip encodings differ between runtimes); the SBOM's random
// serial number and timestamp dropped.
function normalizeRecord(xml: string): string {
  return xml
    .replace(GZIPPED, (_, field: string, data: string) => {
      const text = gunzipSync(Buffer.from(data, "base64")).toString("utf8");
      return `<${field} gunzipped="true">${text}</${field}>`;
    })
    .replace(SBOM_NOISE, "");
}

export function normalizedRecords(directory: string): Map<string, string> {
  const records = new Map<string, string>();
  for (const file of readdirSync(directory, { recursive: true, encoding: "utf8" }).sort()) {
    if (!file.endsWith(".xml")) continue;
    const key = relative(directory, join(directory, file)).split(sep).join("/");
    records.set(key, normalizeRecord(readFileSync(join(directory, file), "utf8")));
  }
  return records;
}
