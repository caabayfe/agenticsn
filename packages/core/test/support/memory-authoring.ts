import {
  type AuthoringWorkspace,
  type BuiltUnit,
  EMPTY_LEDGER,
  type FluentToolchain,
  type Ledger,
  type SourceProject,
} from "@snagentic/core";

// The workspace's Fluent projects and ledgers, in memory. `base` is the last ledger commit.
export function memoryWorkspace(base: string | null = null) {
  const projects = new Map<string, SourceProject>();
  const ledgers = new Map<string, Ledger>();
  const written = new Map<string, string>();
  const merged: unknown[] = [];
  const workspace: AuthoringWorkspace = {
    projects: async () => [...projects.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    project: async (scope) => projects.get(scope) ?? null,
    scaffold: async ({ name, sysId }) => {
      const project = { path: `source/${name}`, scope: name, scopeId: sysId };
      projects.set(name, project);
      return project;
    },
    readLedger: async (project) => ledgers.get(project.path) ?? EMPTY_LEDGER,
    writeLedger: async (project, ledger) => {
      ledgers.set(project.path, ledger);
    },
    writeFiles: async (project, files) => {
      for (const [path, text] of files) written.set(`${project.path}/${path}`, text);
    },
    ledgerCommit: async () => base,
    mergeFiles: async (project, from, files) => {
      merged.push({ project: project.path, from, files: [...files.keys()] });
      return [];
    },
  };
  const add = (scope: string, scopeId: string) => {
    const project = { path: `source/${scope}`, scope, scopeId };
    projects.set(scope, project);
    return project;
  };
  return { workspace, projects, ledgers, written, merged, add };
}

// A toolchain: each project's build is `builds.get(path)`, and a transform turns the build
// from `before` into `after`.
export function memoryToolchain(
  options: {
    readonly after?: readonly BuiltUnit[];
    readonly before?: readonly BuiltUnit[];
    readonly builds?: ReadonlyMap<string, readonly BuiltUnit[]>;
    // A built file's XML by update name; a placeholder otherwise.
    readonly xml?: ReadonlyMap<string, string>;
  } = {},
) {
  const asked: unknown[] = [];
  const chain: FluentToolchain = {
    build: async (project) => {
      const units = options.builds?.get(project.path) ?? [];
      const files = new Map(
        units.map((unit) => [
          unit.file,
          options.xml?.get(unit.updateName) ?? `<xml>${unit.updateName}</xml>`,
        ]),
      );
      return { ok: true, units, files };
    },
    draftTransform: async (project, records, _access, commit) => {
      asked.push({ project: project.path, records, ...(commit === undefined ? {} : { commit }) });
      const files = new Map([["src/fluent/generated/si.now.ts", "ScriptInclude({})"]]);
      return {
        ok: true,
        draft: { before: options.before ?? [], after: options.after ?? [], files },
      };
    },
  };
  return { chain, asked };
}
