import type { PackSource } from "@snagentic/core";

// Accelerator packs in memory, in format 2 (ADR-0038). Manifests are written as JSON, which is
// YAML too, so the fake parses with JSON.parse.

export interface PackFixture {
  // accelerator.yaml's fields.
  readonly pack: Readonly<Record<string, unknown>>;
  // Each modules/<module>/module.yaml's fields, by module id.
  readonly modules: Readonly<Record<string, unknown>>;
  // Other pack files (source, adopt, demo data), by path in the pack.
  readonly files?: Readonly<Record<string, string>>;
}

export function packFiles(fixture: PackFixture): Map<string, string> {
  return new Map([
    ["accelerator.yaml", JSON.stringify(fixture.pack)],
    ...Object.entries(fixture.modules).map(([id, module]): [string, string] => [
      `modules/${id}/module.yaml`,
      JSON.stringify(module),
    ]),
    ...Object.entries(fixture.files ?? {}),
  ]);
}

export function memoryPacks(
  packs: Readonly<Record<string, ReadonlyMap<string, string>>>,
): PackSource {
  return {
    ids: async () => Object.keys(packs).sort(),
    files: async (id) => packs[id] ?? new Map(),
    parse: (text) => JSON.parse(text),
  };
}
