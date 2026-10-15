// Spike S13, test A4: the normalization a plan id would hash (ADR-0028 item 2).
//   bun normalize.ts <dist dir> [<dist dir> ...]   prints each build's digest
// - gzipped base64 field values (`values`, `trigger_inputs`, ...) are replaced by their text, so
//   the gzip encoding (Bun's differs from Node's) does not count, only the content;
// - the SBOM's random serial number and build timestamp are dropped;
// - only the records count (`*.xml`); the CLI's `package_inventory.csv` is not part of them.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const GZIPPED = /<([a-z_]+)>(H4sI[A-Za-z0-9+/=]+)<\/\1>/g;
const SBOM_NOISE = /\n\s*"(serialNumber|timestamp)": "[^"]*",?/g;

export function normalizeRecord(xml: string): string {
  return xml
    .replace(GZIPPED, (_, field: string, data: string) => {
      const text = gunzipSync(Buffer.from(data, "base64")).toString("utf8");
      return `<${field} gunzipped="true">${text}</${field}>`;
    })
    .replace(SBOM_NOISE, "");
}

export function normalizedRecords(dist: string): Map<string, string> {
  const records = new Map<string, string>();
  const files = readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".xml"))
    .sort();
  for (const file of files) {
    const key = relative(dist, join(dist, file)).split(sep).join("/");
    records.set(key, normalizeRecord(readFileSync(join(dist, file), "utf8")));
  }
  return records;
}

export function digest(dist: string): string {
  const hash = createHash("sha256");
  for (const [key, text] of normalizedRecords(dist)) hash.update(`${key}\0${text}\0`);
  return hash.digest("hex");
}

if (import.meta.main) {
  for (const dist of process.argv.slice(2)) console.log(digest(dist), dist);
}
