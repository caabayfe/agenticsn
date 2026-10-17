// Spike S16: an empty Fluent `configuration` project for one scope, using the SDK and types
// installed in this repository (no npm install). Not product code.
//   bun scaffold.ts <dir> <scope> <scope sys_id>
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dir = "", scope = "", scopeId = ""] = process.argv.slice(2);
const repo = resolve(import.meta.dir, "../../..");
const sdk = join(repo, "packages/cli/node_modules/@servicenow");
const store = join(repo, "node_modules/.bun");

mkdirSync(join(dir, "node_modules/@servicenow"), { recursive: true });
mkdirSync(join(dir, "src/fluent"), { recursive: true });
symlinkSync(join(sdk, "sdk"), join(dir, "node_modules/@servicenow/sdk"));
symlinkSync(
  join(store, "@servicenow+glide@27.0.5/node_modules/@servicenow/glide"),
  join(dir, "node_modules/@servicenow/glide"),
);
writeFileSync(
  join(dir, "now.config.json"),
  `${JSON.stringify({ scope, scopeId, name: `S16 ${scope}`, type: "configuration" }, null, 4)}\n`,
);
writeFileSync(
  join(dir, "package.json"),
  `${JSON.stringify(
    {
      name: `s16-${scope.replace(/_/g, "-")}`,
      version: "0.0.1",
      license: "UNLICENSED",
      imports: { "#now:*": "./@types/servicenow/fluent/*/index.js" },
      devDependencies: { "@servicenow/sdk": "4.13.6", "@servicenow/glide": "27.0.5" },
    },
    null,
    4,
  )}\n`,
);
console.log(`project ${scope} in ${dir}`);
