// Spike S13/A1: collect the files a Fluent build reads from a project's node_modules into one
// gzipped JSON asset ({ "<path under node_modules>": "<text>" }) to embed in the binary.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const modules = join(process.argv[2] ?? "app", "node_modules");
const PACKAGES = [
  "@servicenow/sdk",
  "@servicenow/sdk-core",
  "@servicenow/sdk-build-plugins",
  "@types/estree",
  "@types/json-schema",
  // Server modules import gs, GlideRecord and the rest from it (test A2).
  "@servicenow/glide",
];
const KEEP = /(\.d\.ts|\.ts|package\.json)$/;
const files: Record<string, string> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (KEEP.test(name) && !name.endsWith(".map"))
      files[relative(modules, full)] = readFileSync(full, "utf8");
  }
};
for (const pkg of PACKAGES) walk(join(modules, pkg));
const json = JSON.stringify(files);
writeFileSync("types.json.gz", gzipSync(json, { level: 9 }));
console.log(
  "files",
  Object.keys(files).length,
  "raw MB",
  (json.length / 1e6).toFixed(1),
  "gz MB",
  (statSync("types.json.gz").size / 1e6).toFixed(2),
);
