// Temporary diagnostic (not for main): the product's in-process SDK 4.14 build of every Fluent
// fixture on Windows, compared with the CLI goldens and the committed keys.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadInProcessRuntime } from "../../packages/cli/src/adapters/fluent/fluent-runtime-loader";
import {
  copyFixture,
  FLUENT_FIXTURES,
  KEYS_FILE,
  normalizedRecords,
} from "../../packages/cli/test/support/fluent-fixtures";

const runtime = await loadInProcessRuntime();
let failed = 0;
for (const fixture of readdirSync(FLUENT_FIXTURES).sort()) {
  const source = join(FLUENT_FIXTURES, fixture);
  const project = copyFixture(source);
  const outcome = await runtime.build(project);
  const want = readFileSync(join(source, KEYS_FILE), "utf8").replace(/\r\n/g, "\n");
  const got = readFileSync(join(project, KEYS_FILE), "utf8");
  const keysSame = got === readFileSync(join(source, KEYS_FILE), "utf8");
  const a = normalizedRecords(join(source, "expected"));
  const b = outcome.success ? normalizedRecords(join(project, "dist", "app")) : new Map();
  const differing = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  const ok = outcome.success && keysSame && differing.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${fixture}: success ${outcome.success}, records ${b.size}/${a.size}, differing ${differing.length}, keys ${keysSame ? "same" : "CHANGED"}${got === want ? "" : " (not only CRLF)"}`);
  if (!keysSame) {
    const w = readFileSync(join(source, KEYS_FILE), "utf8").split("\n");
    const g = got.split("\n");
    for (let i = 0, shown = 0; i < Math.max(w.length, g.length) && shown < 6; i++) {
      if (w[i] !== g[i]) {
        console.log(`   line ${i + 1}: ${JSON.stringify(w[i])} -> ${JSON.stringify(g[i])}`);
        shown++;
      }
    }
  }
}
console.log(`${failed} failed`);
