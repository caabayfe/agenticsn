import type {
  BuiltUnit,
  FluentBuild,
  FluentProject,
  FluentProjects,
  MirrorState,
  ScriptChecker,
  ScriptContext,
  ValidateDependencies,
} from "@snagentic/core";

// validate's ports in memory (ADR-0031 item 6): Fluent projects with a build now and at the base,
// the instance's mirror, and a checker that reports each /*RULE-ID*/ marker on its line.

export function fakeChecker(seen: { ruleIds: readonly string[]; context: ScriptContext }[] = []) {
  const checker: ScriptChecker = {
    check(source, ruleIds, context) {
      seen.push({ ruleIds, context });
      const lines = source.split("\n");
      const broken = lines.findIndex((line) => line.includes("SYNTAX ERROR"));
      if (broken >= 0) {
        return { parsed: false, line: broken + 1, message: "Unexpected token ERROR" };
      }
      const hits = lines.flatMap((line, index) =>
        [...line.matchAll(/\/\*(SN-[A-Z]+-\d+)\*\//g)].flatMap(([, ruleId = ""]) =>
          ruleIds.includes(ruleId) ? [{ ruleId, line: index + 1, message: `hit ${ruleId}` }] : [],
        ),
      );
      return { parsed: true, hits };
    },
  };
  return checker;
}

let count = 0;

// A unit of one record; its sys_id is made up unless given.
export function unitOf(table: string, fields: Record<string, string>, sysId?: string): BuiltUnit {
  count += 1;
  const id = sysId ?? `${count}`.padStart(32, "0");
  return {
    updateName: `${table}_${id}`,
    file: `${table}_${id}.xml`,
    head: {
      table,
      sysId: id,
      action: "INSERT_OR_UPDATE",
      fields: { sys_id: id, ...fields },
      referenceNames: {},
    },
    children: [],
  };
}

export interface ProjectBuilds {
  readonly now: readonly BuiltUnit[] | { readonly errors: FluentBuildErrorLike[] };
  // The build at the base commit; null: the project did not exist then.
  readonly base?: readonly BuiltUnit[] | null;
  // Builds at other commits, by commit (a project's ledger commit).
  readonly at?: Readonly<Record<string, readonly BuiltUnit[]>>;
  readonly scripts?: ReadonlyMap<string, string>;
  readonly keys?: { readonly committed: string | null; readonly built: string } | null;
  readonly declaredSdk?: string | null;
  // Left as it was since the base commit: changedSince doesn't name it.
  readonly unchanged?: boolean;
}

interface FluentBuildErrorLike {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

export function fakeProjects(projects: Record<string, ProjectBuilds>, sdkVersion = "4.13.6") {
  const built: string[] = [];
  const of = (path: string): FluentProject => ({
    path,
    declaredSdk: projects[path]?.declaredSdk ?? null,
  });
  const build = (units: readonly BuiltUnit[], builds: ProjectBuilds): FluentBuild => ({
    built: true,
    keys: builds.keys ?? null,
    deletes: [],
    units,
    scripts: builds.scripts ?? new Map(),
  });
  const fluent: FluentProjects = {
    changedSince: async () =>
      Object.keys(projects)
        .filter((p) => projects[p]?.unchanged !== true)
        .sort()
        .map(of),
    holding: async (paths) =>
      Object.keys(projects)
        .filter((p) => paths.some((path) => path.startsWith(`${p}/`)))
        .sort()
        .map(of),
    build: async (project) => {
      built.push(project.path);
      const builds = projects[project.path];
      if (builds === undefined) throw new Error(`no project ${project.path}`);
      return "errors" in builds.now
        ? { built: false, errors: builds.now.errors }
        : build(builds.now, builds);
    },
    buildAt: async (project, commit) => {
      const builds = projects[project.path];
      const other = builds?.at?.[commit];
      if (builds !== undefined && other !== undefined)
        return build(other, { ...builds, keys: null });
      const base = builds?.base;
      return builds === undefined || base === undefined || base === null
        ? null
        : build(base, { ...builds, keys: null });
    },
    writeKeys: async () => {},
    sdkVersion: async () => sdkVersion,
  };
  return { fluent, built };
}

export function fakeMirror(
  options: { edited?: readonly string[]; privileges?: Record<string, readonly string[]> } = {},
) {
  let asked = 0;
  const mirror: MirrorState = {
    resolve: async (ref) => (ref === "nope" ? null : ref === "HEAD" ? "c0ffee" : ref),
    edited: async () => options.edited ?? [],
    privileges: async (scope) => {
      asked += 1;
      return options.privileges?.[scope] ?? [];
    },
  };
  return { mirror, asked: () => asked };
}

export function governanceOf(
  projects: Record<string, ProjectBuilds>,
  options: Parameters<typeof fakeMirror>[0] & { checker?: ScriptChecker } = {},
): ValidateDependencies & { built: string[]; asked: () => number } {
  const { fluent, built } = fakeProjects(projects);
  const { mirror, asked } = fakeMirror(options);
  return { fluent, mirror, checker: options.checker ?? fakeChecker(), built, asked };
}
