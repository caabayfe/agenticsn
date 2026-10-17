// Test plan L1 (spec 009): can every record of a class enter Fluent? For each record, what
// adopt does, without writing source: convert, fix, build, check secrets, read the live copies,
// compare. Read-only on the instance. Each record ends adoptable (with its named losses),
// refused (with the reason), or failing.
//   bun tests/live/verify/adopt-census.ts <workspace> <instance> <table> [--limit n]
//     [--evidence <dir>]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadFluentRuntime } from "../../../packages/cli/src/adapters/fluent/fluent-runtime-loader";
import { SdkToolchain } from "../../../packages/cli/src/adapters/fluent/fluent-toolchain";
import { fromYamlStrings } from "../../../packages/cli/src/adapters/yaml/own-style";
import { unitCatalog } from "../../../packages/core/src/authoring/application/unit-catalog";
import { unitSecrets } from "../../../packages/core/src/authoring/domain/unit-secrets";
import {
  type BuiltUnit,
  compareUnit,
  conversionRefusal,
  DEFAULT_REDACTION,
  type InstanceCopy,
  knownLoss,
  knownRefusal,
  readUnits,
  unitSpec,
} from "../../../packages/core/src/index";
import { liveClient } from "./live-connection";
import { MirrorReader } from "./mirror-reader";

const BATCH = 25;
const signal = new AbortController().signal;

type Verdict =
  | { readonly kind: "adoptable"; readonly losses: readonly string[] }
  | { readonly kind: "refused" | "failing"; readonly reason: string };

interface Scope {
  readonly name: string;
  readonly sysId: string;
}

// The records of a table in the mirror, by scope (folder) and scope sys_id (_meta.sys_scope).
async function population(mirror: MirrorReader, instance: string, table: string, limit: number) {
  const pattern = new RegExp(
    `/metadata/(?:domains/[^/]+/)?([^/]+)/${table}/[^/]+--([A-Za-z0-9_]+)\\.yaml$`,
  );
  const byScope = new Map<string, { scope: Scope; ids: string[] }>();
  for (const path of await mirror.paths(`instances/${instance}/metadata`)) {
    const match = pattern.exec(path);
    if (match === null) continue;
    const [, name = "", id = ""] = match;
    const entry = byScope.get(name);
    if (entry === undefined) {
      const meta = (fromYamlStrings((await mirror.read(path)) ?? "") as Record<string, unknown>)[
        "_meta"
      ] as Record<string, string>;
      byScope.set(name, { scope: { name, sysId: meta["sys_scope"] ?? name }, ids: [id] });
    } else entry.ids.push(id);
  }
  let left = limit;
  return [...byScope.values()]
    .sort((a, b) => b.ids.length - a.ids.length)
    .map(({ scope, ids }) => {
      const taken = ids.sort().slice(0, Math.max(0, left));
      left -= taken.length;
      return { scope, ids: taken };
    })
    .filter(({ ids }) => ids.length > 0);
}

function project(root: string, scope: Scope) {
  const path = `source/${scope.name}`;
  const dir = join(root, path);
  mkdirSync(join(dir, "src/fluent"), { recursive: true });
  const config = {
    scope: scope.name,
    scopeId: scope.sysId,
    name: scope.name,
    type: "configuration",
  };
  writeFileSync(join(dir, "now.config.json"), JSON.stringify(config));
  const manifest = {
    name: "census",
    version: "0.0.1",
    devDependencies: { "@servicenow/sdk": "4.13.6" },
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return { path, scope: scope.name, scopeId: scope.sysId };
}

type Client = Awaited<ReturnType<typeof liveClient>>;

// A unit against its live copy: its named losses, or why it can't be adopted.
function unitVerdict(
  unit: BuiltUnit,
  copy: InstanceCopy | null | undefined,
  losses: Set<string>,
): Verdict | null {
  if (copy === null || copy === undefined) {
    return {
      kind: "failing",
      reason: `${unit.head.table}: the build makes a record the instance lacks`,
    };
  }
  if (copy.foreignRows > 0) return { kind: "refused", reason: "rows in a domain the SDK drops" };
  // As adopt does: units the platform compiles after a load (flows) aren't compared.
  const differences = unitSpec(unit.head.table).comparable ? compareUnit(unit, copy) : [];
  for (const difference of differences) {
    const loss = knownLoss(difference);
    if (loss !== null) {
      losses.add(loss);
      continue;
    }
    const refusal = knownRefusal(difference);
    if (refusal !== null) return { kind: "refused", reason: refusal };
    const what =
      difference.kind === "field"
        ? `${difference.table}.${difference.field}`
        : `${difference.table} rows`;
    return { kind: "failing", reason: `unexplained difference: ${what}` };
  }
  return null;
}

// The record a built unit belongs to: its own sys_id, or a record it names in a field (a
// policy's actions, a role's containments). Null when it names none of the batch's records.
function ownerOf(unit: BuiltUnit, ids: ReadonlySet<string>): string | null {
  if (ids.has(unit.head.sysId)) return unit.head.sysId;
  for (const value of Object.values(unit.head.fields)) if (ids.has(value)) return value;
  return null;
}

const worse = (a: Verdict | undefined, b: Verdict): Verdict => {
  if (a === undefined || a.kind === "adoptable") {
    if (b.kind !== "adoptable" || a === undefined) return b;
    return { kind: "adoptable", losses: [...new Set([...a.losses, ...b.losses])].sort() };
  }
  return a;
};

function verdictOf(
  unit: BuiltUnit,
  catalog: Awaited<ReturnType<typeof unitCatalog>>,
  copy: InstanceCopy | null | undefined,
): Verdict {
  const secrets = unitSecrets([unit], catalog, DEFAULT_REDACTION);
  if (secrets.length > 0) return { kind: "refused", reason: `secret in source: ${secrets[0]}` };
  const losses = new Set<string>();
  return unitVerdict(unit, copy, losses) ?? { kind: "adoptable", losses: [...losses].sort() };
}

// Verdicts per record of a converted batch: each unit judged on its own and charged to the
// record it belongs to. Null when a failing unit can't be charged to one record.
async function judge(
  client: Client,
  units: readonly BuiltUnit[],
  ids: readonly string[],
): Promise<Map<string, Verdict> | null> {
  const catalog = await unitCatalog({ reader: client, signal }, units);
  const copies = await readUnits(client, units, signal);
  const own = new Set(ids);
  const verdicts = new Map<string, Verdict>();
  for (const unit of units) {
    const verdict = verdictOf(unit, catalog, copies.get(unit.updateName));
    const owner = ownerOf(unit, own) ?? (ids.length === 1 ? (ids[0] ?? "") : null);
    if (owner === null) {
      if (verdict.kind !== "adoptable") return null;
      continue;
    }
    verdicts.set(owner, worse(verdicts.get(owner), verdict));
  }
  for (const id of ids) if (!verdicts.has(id)) verdicts.set(id, { kind: "adoptable", losses: [] });
  return verdicts;
}

// Converts a batch; a batch that doesn't build, or whose failure can't be charged to one
// record, is split until each failure is one record.
async function census(
  tools: SdkToolchain,
  client: Client,
  target: ReturnType<typeof project>,
  table: string,
  ids: readonly string[],
  out: Map<string, Verdict>,
): Promise<void> {
  const records = ids.map((sysId) => ({ table, sysId }));
  const draft = await tools.draftTransform(target, records, client.sdkAccess(signal));
  if (draft.ok) {
    const verdicts = await judge(client, draft.draft.after, ids);
    if (verdicts !== null) {
      for (const [id, verdict] of verdicts) out.set(id, verdict);
      return;
    }
  } else if (ids.length === 1) {
    // As adopt does: a conversion fix's refusal, or a conversion the SDK can't make (named).
    const named = conversionRefusal(draft.message);
    const refused = named !== null || /can't express|Accessible from/.test(draft.message);
    out.set(ids[0] ?? "", {
      kind: refused ? "refused" : "failing",
      reason: (named ?? draft.message).slice(0, 200),
    });
    return;
  }
  const half = Math.ceil(ids.length / 2);
  await census(tools, client, target, table, ids.slice(0, half), out);
  await census(tools, client, target, table, ids.slice(half), out);
}

function report(table: string, verdicts: ReadonlyMap<string, Verdict>) {
  const buckets: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const losses: Record<string, number> = {};
  for (const verdict of verdicts.values()) {
    buckets[verdict.kind] = (buckets[verdict.kind] ?? 0) + 1;
    if (verdict.kind === "adoptable")
      for (const loss of verdict.losses) losses[loss] = (losses[loss] ?? 0) + 1;
    else {
      const key = `${verdict.kind}: ${verdict.reason.replace(/[0-9a-f]{32}/g, "<id>").slice(0, 120)}`;
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  }
  return { table, records: verdicts.size, buckets, losses, reasons };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args.splice(at, 2)[1];
  };
  const limit = Number(option("--limit") ?? "100000");
  const evidence = option("--evidence");
  const [workspace = ".", instance = "", table = ""] = args;
  const repository = resolve(workspace);
  const mirror = new MirrorReader(repository, `servicenow-remote/${instance}`);
  const client = await liveClient(instance, repository);
  const root = mkdtempSync(join(tmpdir(), "snagentic-census-"));
  const tools = new SdkToolchain(root, loadFluentRuntime);
  const verdicts = new Map<string, Verdict>();
  for (const { scope, ids } of await population(mirror, instance, table, limit)) {
    const target = project(root, scope);
    for (let i = 0; i < ids.length; i += BATCH) {
      await census(tools, client, target, table, ids.slice(i, i + BATCH), verdicts);
      console.log(`${table} ${scope.name}: ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
    }
  }
  mirror.close();
  const result = { ...report(table, verdicts), verdicts: Object.fromEntries(verdicts) };
  console.log(JSON.stringify(report(table, verdicts), null, 2));
  if (evidence !== undefined) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, `${table}.json`), `${JSON.stringify(result, null, 2)}\n`);
  }
}

await main();
