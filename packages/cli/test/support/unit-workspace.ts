import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type FluentInstaller,
  type FluentToolchain,
  type Row,
  unitDigest,
  withEntries,
} from "@snagentic/core";
import type { fakeInstance } from "../../../core/test/support/fake-instance";
import { builtUnitOf } from "../../src/adapters/fluent/built-units";
import { WorkspaceAuthoring } from "../../src/adapters/fluent/workspace-authoring";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import type { UseCaseContext } from "../../src/registry/use-case";
import { instanceWorkspace } from "./instance-workspace";

// A workspace whose Fluent source (source/x_2222332_s11) adopted the S11 script include from an
// in-memory instance: the built file is the SDK's own (tests/fixtures/sdk/units), its
// description edited in source.

const FIXTURE = join(import.meta.dir, "../../../../tests/fixtures/sdk/units");
export const SI_FILE = "sys_script_include_123833b4d97d48be8e9ec5ea16f27764.xml";
export const SI_UNIT = "sys_script_include_123833b4d97d48be8e9ec5ea16f27764";
const SCOPE = { name: "x_2222332_s11", sysId: "489da54ae67c4a3e9f1e1e4347e9119b" };

const builtXml = (description: string) =>
  readFileSync(join(FIXTURE, SI_FILE), "utf8").replace(
    "<description/>",
    description === "" ? "<description/>" : `<description>${description}</description>`,
  );

const runtime = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

// fluent/load on the in-memory instance: each file applied as built, recorded in the set by the
// user signed in.
function installer(
  tables: Record<string, Row[]>,
  loads: string[],
  username: string,
): FluentInstaller {
  return {
    load: async (_scopeId, files, updateSet) => {
      for (const file of files) {
        loads.push(file.content);
        const unit = builtUnitOf(file.name, file.content);
        const rows = tables[unit.head.table] ?? [];
        const others = rows.filter((r) => r["sys_id"] !== unit.head.sysId);
        tables[unit.head.table] = [
          ...others,
          { ...rows.find((r) => r["sys_id"] === unit.head.sysId), ...unit.head.fields },
        ];
        const updates = tables["sys_update_xml"] ?? [];
        tables["sys_update_xml"] = [
          ...updates,
          {
            sys_id: `x${updates.length}`,
            name: unit.updateName,
            update_set: updateSet,
            sys_updated_by: username,
          },
        ];
      }
    },
    publish: async () => [],
  };
}

const EMPTY_KEYS = `import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {}
        }
    }
}
`;

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

// The instance rows the S11 workspace adopted from, as `username` sees them; `description` is the
// script include's on the instance.
export function s11Tables(description: string, username = "admin"): Record<string, Row[]> {
  return {
    sys_user: [{ sys_id: "u1", user_name: username }],
    sys_update_set: [],
    sys_update_xml: [],
    sys_user_preference: [],
    sys_script_include: [
      {
        ...builtUnitOf(SI_FILE, builtXml(description)).head.fields,
        sys_class_name: "sys_script_include",
        sys_scope: SCOPE.sysId,
        sys_mod_count: "1",
        sys_updated_on: "2026-10-16 06:30:48",
        sys_update_name: SI_UNIT,
        sys_domain: "global",
      },
    ],
  };
}

// Adopts the S11 script include into a workspace already connected to an instance holding
// s11Tables: the project, its ledger and source (`source` is the description edited in it),
// committed. The context it returns builds with the SDK's own file and loads into the instance.
export async function adoptS11(
  ws: {
    readonly root: string;
    readonly context: UseCaseContext;
    readonly instance: Pick<ReturnType<typeof fakeInstance>, "tables" | "reader">;
  },
  options: { readonly source: string; readonly instance: string; readonly username?: string },
) {
  const tables = ws.instance.tables;
  const authoring = new WorkspaceAuthoring(ws.root, runtime);
  const project = await authoring.scaffold(SCOPE);
  const adopted = builtUnitOf(SI_FILE, builtXml(options.instance));
  const entry = { build: unitDigest(adopted), instance: "1|2026-10-16 06:30:48", losses: [] };
  await authoring.writeLedger(project, withEntries(new Map(), "pdi", new Map([[SI_UNIT, entry]])));
  await mkdir(join(ws.root, project.path, "src/fluent"), { recursive: true });
  await writeFile(join(ws.root, project.path, "src/fluent/si.now.ts"), `// ${options.source}\n`);
  // The keys file the SDK writes for this source, committed as fluent-keys would.
  await mkdir(join(ws.root, project.path, "src/fluent/generated"), { recursive: true });
  await writeFile(join(ws.root, project.path, "src/fluent/generated/keys.ts"), EMPTY_KEYS);
  await git(ws.root, "add", "-A");
  await git(ws.root, "commit", "-qm", "adopt");
  const xml = builtXml(options.source);
  const toolchain: FluentToolchain = {
    build: async () => ({
      ok: true,
      units: [builtUnitOf(SI_FILE, xml)],
      files: new Map([[SI_FILE, xml]]),
    }),
    draftTransform: async () => ({ ok: false, message: "unused" }),
  };
  const loads: string[] = [];
  const fluent = installer(tables, loads, options.username ?? "admin");
  const reader = { ...ws.instance.reader, fluent };
  const context: UseCaseContext = {
    ...ws.context,
    connections: { open: () => reader, openForWrite: () => reader },
    authoring: () => ({ workspace: authoring, toolchain }),
  };
  return { context, tables, loads, project };
}

export async function unitWorkspace(options: {
  readonly source: string;
  readonly instance: string;
}) {
  const ws = await instanceWorkspace(s11Tables(options.instance));
  const adopted = await adoptS11(ws, options);
  return { ...ws, ...adopted, git: (...args: string[]) => git(ws.root, ...args) };
}

// A test that plans against this workspace builds, validates and reads a real git repository;
// the first in a run also loads the toolchain. Over 5 s on a loaded machine, about 5 s on a CI
// runner (#102), so such tests get 15 s.
export const PLAN_TIMEOUT = 15_000;
