import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { NowConfig } from "@servicenow/sdk-build-core";
import type { FluentBuildError } from "./fluent-build-error";

// A workspace is not trusted input: a cloned repository, a pull request or an agent's edit can
// put anything in it, and the hooks build it unasked. The SDK runs inside snagentic, with the
// instance's credentials in reach, so a project that would make it run the project's code or
// touch files outside the project is refused before the SDK sees it (S1; spec 012, B-01, B-03,
// B-15). snagentic builds metadata only, so none of these is needed.

const refusal = (file: string, code: string, message: string): FluentBuildError => ({
  file,
  line: 1,
  column: 1,
  code,
  message,
});

// The scripts the SDK's build imports and runs: those named in now.config.json, else
// now.<name>.mjs beside it.
const BUILD_SCRIPTS = ["prebuild", "postbuild"] as const;

function buildScripts(config: NowConfig, rootDir: string): FluentBuildError[] {
  const declared: Readonly<Record<string, string>> = config.scripts ?? {};
  return BUILD_SCRIPTS.flatMap((name) => {
    const file =
      declared[name] !== undefined
        ? "now.config.json"
        : existsSync(join(rootDir, `now.${name}.mjs`))
          ? `now.${name}.mjs`
          : null;
    return file === null
      ? []
      : [
          refusal(
            file,
            "snagentic-project-script",
            `the project has a ${name} script; snagentic doesn't run project scripts, which would run with its access to the instance: remove it`,
          ),
        ];
  });
}

// The Prettier configs the SDK imports as modules when it formats what it writes; JSON ones are
// only read.
const FORMATTER_CODE = new Set(
  [".prettierrc", "prettier.config"].flatMap((stem) =>
    [".js", ".mjs", ".cjs"].map((ext) => `${stem}${ext}`),
  ),
);

interface ProjectEntry {
  readonly path: string;
  readonly name: string;
  readonly link: boolean;
  readonly file: boolean;
}

// Every file and link in the project, outside installed dependencies. Written out because
// readdirSync's recursive mode follows links, into whatever they point to.
function projectEntries(rootDir: string, folder = ""): ProjectEntry[] {
  return readdirSync(join(rootDir, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : projectEntries(rootDir, path);
    }
    return [{ path, name: entry.name, link: entry.isSymbolicLink(), file: entry.isFile() }];
  });
}

function projectFiles(rootDir: string): FluentBuildError[] {
  return projectEntries(rootDir).flatMap(({ path, name, link, file }) => {
    if (link) {
      return [
        refusal(
          path,
          "snagentic-project-link",
          "the project holds a symbolic link, which could lead the build outside the project: replace it with the files it points to",
        ),
      ];
    }
    if (file && FORMATTER_CODE.has(name)) {
      return [
        refusal(
          path,
          "snagentic-project-formatter",
          "the project has a Prettier config written as code, which the build would run with snagentic's access to the instance: use .prettierrc.json instead",
        ),
      ];
    }
    return [];
  });
}

// The folders now.config.json names, which the SDK reads, writes and deletes before each build.
const FOLDERS = [
  "metadataDir",
  "fluentDir",
  "clientDir",
  "typesDir",
  "generatedDir",
  "staticContentDir",
  "appOutputDir",
  "packOutputDir",
  "tsconfigPath",
] as const;

const valuesOf = (record: unknown): unknown[] =>
  typeof record === "object" && record !== null ? Object.values(record) : [];

function namedFolders(config: NowConfig): (readonly [string, unknown])[] {
  const staticContent: unknown = Reflect.get(config, "staticContent");
  const nested = typeof staticContent === "object" && staticContent !== null ? staticContent : {};
  return [
    ["staticContent.buildDir", Reflect.get(nested, "buildDir")],
    ...valuesOf(Reflect.get(nested, "paths")).map((v) => ["staticContent.paths", v] as const),
    ...valuesOf(Reflect.get(config, "staticContentPaths")).map(
      (v) => ["staticContentPaths", v] as const,
    ),
    ...FOLDERS.map((name) => [name, Reflect.get(config, name)] as const),
  ];
}

function configFolders(config: NowConfig, rootDir: string): FluentBuildError[] {
  return namedFolders(config).flatMap(([name, value]) => {
    if (typeof value !== "string") return [];
    const inside = relative(rootDir, resolve(rootDir, value));
    if (!isAbsolute(value) && inside !== ".." && !inside.startsWith(`..${sep}`)) return [];
    return [
      refusal(
        "now.config.json",
        "snagentic-project-path",
        `${name} names ${value}, outside the project; the build writes and deletes there: name a folder inside the project`,
      ),
    ];
  });
}

// Checked before the SDK opens the project: opening it already lists the source files.
export function projectRefusals(config: NowConfig, rootDir: string): FluentBuildError[] {
  return [
    ...buildScripts(config, rootDir),
    ...configFolders(config, rootDir),
    ...projectFiles(rootDir),
  ];
}
