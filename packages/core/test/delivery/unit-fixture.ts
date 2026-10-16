import {
  type BuiltUnit,
  type FluentInstaller,
  type LedgerEntry,
  type PushJournal,
  type Row,
  type UnitPushDependencies,
  unitDigest,
  withEntries,
} from "@snagentic/core";
import { setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";
import { memoryToolchain, memoryWorkspace } from "../support/memory-authoring";

// One Fluent project (x_app) and an instance holding its script include, for plan and push on
// built units (ADR-0031, ADR-0033).

export const SCOPE_ID = "a".repeat(32);
export const SI_ID = "123833b4d97d48be8e9ec5ea16f27764";
export const SI_UNIT = `sys_script_include_${SI_ID}`;
export const VERSION = "1|2026-10-16 06:30:48";

export const scriptInclude = (description: string, sysId = SI_ID): BuiltUnit => ({
  updateName: `sys_script_include_${sysId}`,
  file: `sys_script_include_${sysId}.xml`,
  head: {
    table: "sys_script_include",
    sysId,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: sysId, name: "Util", description, active: "true" },
    referenceNames: {},
  },
  children: [],
});

const instanceRow = (description: string): Row => ({
  sys_id: SI_ID,
  sys_class_name: "sys_script_include",
  sys_scope: SCOPE_ID,
  sys_mod_count: "1",
  sys_updated_on: "2026-10-16 06:30:48",
  sys_update_name: SI_UNIT,
  sys_domain: "global",
  name: "Util",
  description,
  active: "true",
});

function memoryJournal() {
  let stored: PushJournal | null = null;
  return {
    read: async () => stored,
    write: async (journal: PushJournal) => {
      stored = journal;
    },
    clear: async () => {
      stored = null;
    },
  };
}

// fluent/load applied to the in-memory instance: each file's unit is written as built and
// recorded in the target update set, as the platform does.
function installer(
  tables: Record<string, Row[]>,
  units: () => readonly BuiltUnit[],
  calls: string[],
  refused: ReadonlySet<string>,
): FluentInstaller {
  return {
    load: async (scopeId, files, updateSet) => {
      calls.push(`load ${scopeId} ${files.map((f) => f.name).join(",")} into ${updateSet}`);
      for (const file of files) {
        const unit = units().find((u) => u.file === file.name);
        if (unit === undefined) continue;
        const rows = tables[unit.head.table] ?? [];
        if (unit.head.action === "DELETE") {
          // Now.del by keys: the record that has them goes.
          const keys = Object.entries(unit.head.fields).filter(([f]) => !f.startsWith("sys_"));
          tables[unit.head.table] = rows.filter((r) => !keys.every(([f, v]) => r[f] === v));
          continue;
        }
        const current = rows.find((r) => r["sys_id"] === unit.head.sysId);
        const count = String(Number(current?.["sys_mod_count"] ?? "-1") + 1);
        const row = {
          ...current,
          ...unit.head.fields,
          sys_mod_count: count,
          sys_updated_on: "2026-10-16 12:00:00",
          sys_update_name: unit.updateName,
        };
        tables[unit.head.table] = [...rows.filter((r) => r !== current), row];
        const xml = tables["sys_update_xml"] ?? [];
        tables["sys_update_xml"] = [
          ...xml,
          {
            sys_id: `x${unit.updateName}`,
            name: unit.updateName,
            update_set: updateSet,
            sys_updated_by: "admin",
          },
        ];
      }
    },
    publish: async (scope, targets) => {
      calls.push(`publish ${scope} flows=${targets.flows.join(",")}`);
      return targets.flows.map((sysId) => ({
        sysId,
        published: !refused.has(sysId),
        message: "No trigger",
      }));
    },
  };
}

export function unitSetup(
  options: { instance?: string; source?: string; ledger?: Partial<LedgerEntry> | null } = {},
) {
  const base = setup({ changed: [], mirror: {}, working: {} });
  const source = scriptInclude(options.source ?? "Helpers.");
  base.tables["sys_script_include"] = [instanceRow(options.instance ?? "Helpers.")];
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  base.tables["sys_user_preference"] = [];
  const authoring = memoryWorkspace();
  const project = authoring.add("x_app", SCOPE_ID);
  const builds = new Map<string, BuiltUnit[]>([[project.path, [source]]]);
  if (options.ledger !== null) {
    const adopted = scriptInclude("Helpers.");
    const entry = { build: unitDigest(adopted), instance: VERSION, losses: [], ...options.ledger };
    authoring.ledgers.set(project.path, withEntries(new Map(), "dev", new Map([[SI_UNIT, entry]])));
  }
  const xml = new Map<string, string>();
  const toolchain = memoryToolchain({ builds, xml });
  const refused = new Set<string>();
  const calls: string[] = [];
  const journal = memoryJournal();
  const deps: UnitPushDependencies = {
    ...base.deps,
    authoring: { workspace: authoring.workspace, toolchain: toolchain.chain },
    reader: base.fake.reader,
    writer: memoryWriter(base.tables, calls),
    journal,
    username: "admin",
    url: "https://dev.example.com",
    pullRequests: {
      find: async () => ({ kind: "none" }),
      defaultBranch: async () => "main",
      openDraft: async () => "",
    },
    installer: installer(base.tables, () => [...builds.values()].flat(), calls, refused),
  };
  return { ...base, deps, authoring, project, builds, calls, journal, xml, refused };
}

export const QUERY = { instance: "dev", allowCollisions: false };

// Someone saves the script include on the instance.
export function saveOnInstance(tables: Record<string, Row[]>, fields: Record<string, string>) {
  tables["sys_script_include"] = (tables["sys_script_include"] ?? []).map((row) => ({
    ...row,
    ...fields,
  }));
}
