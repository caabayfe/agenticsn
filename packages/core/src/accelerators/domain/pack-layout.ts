// Where things are in a pack of format 2 (ADR-0038). Pure: paths are pack-relative, with "/".
//
//   accelerator.yaml                          the pack: id, version, requires, tested, profiles
//   README.md                                 the pack's map (not installed)
//   modules/<module>/module.yaml              the module: label, dependsOn, components, data
//   modules/<module>/README.md                the module sheet (not installed)
//   modules/<module>/source/<scope>/...       Fluent projects, copied to source/<scope>/...
//   modules/<module>/adopt.yaml               out-of-box records the module customizes
//   modules/<module>/data/demo/<entity>.csv   fictional demo data

export const PACK_MANIFEST = "accelerator.yaml";
const MODULE_FILE = /^modules\/([^/]+)\/module\.yaml$/;
const ADOPT_FILE = /^modules\/([^/]+)\/adopt\.yaml$/;
const DEMO_DIRECTORY = "data/demo";

// Format 1 kept capabilities in accelerator.yaml and content under source/, adopt/ and data/.
const FORMAT_1 = /^(source|adopt|data|metadata|patches)\//;

const parts = (path: string) => path.split("/");

// The module a pack file belongs to, or null.
export function moduleOf(path: string): string | null {
  const [top, module, ...rest] = parts(path);
  return top === "modules" && module !== undefined && rest.length > 0 ? module : null;
}

export const isAdoptFile = (path: string): boolean => ADOPT_FILE.test(path);

// The workspace path a module's source file is copied to, or null outside a project folder.
export function workspacePathOf(path: string): string | null {
  const [top, , folder, scope, ...rest] = parts(path);
  if (top !== "modules" || folder !== "source" || scope === undefined || rest.length === 0) {
    return null;
  }
  return ["source", scope, ...rest].join("/");
}

// Pack files that are documentation, the manifests or data: never copied to the workspace.
export function isPackOnly(path: string): boolean {
  if (path === PACK_MANIFEST || path.endsWith(".md")) return true;
  const [top, , folder] = parts(path);
  return top === "modules" && (folder === "module.yaml" || folder === "data");
}

// The pack path of a module's demo template.
export const demoPath = (module: string, file: string): string =>
  `modules/${module}/${DEMO_DIRECTORY}/${file}`;

// The pack document parseManifest reads: accelerator.yaml with each module.yaml under `modules`.
export function packDocument(
  files: ReadonlyMap<string, string>,
  parse: (text: string) => unknown,
): { readonly document: unknown; readonly problems: readonly string[] } {
  const text = files.get(PACK_MANIFEST);
  if (text === undefined) return { document: null, problems: [`${PACK_MANIFEST} is missing`] };
  const head = parse(text);
  const old = [...files.keys()].filter((p) => FORMAT_1.test(p));
  const capabilities = head !== null && typeof head === "object" && "capabilities" in head;
  if (old.length > 0 || capabilities) {
    return {
      document: null,
      problems: [
        "pack format 1 (capabilities in accelerator.yaml, content under source/): move each capability to modules/<module>/ with a module.yaml (ADR-0038)",
      ],
    };
  }
  const modules: Record<string, unknown> = {};
  for (const [path, content] of files) {
    const id = MODULE_FILE.exec(path)?.[1];
    if (id !== undefined) modules[id] = parse(content);
  }
  const document = head !== null && typeof head === "object" ? { ...head, modules } : head;
  return { document, problems: [] };
}
