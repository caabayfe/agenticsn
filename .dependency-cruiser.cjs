// Architecture boundaries (ADR-0001, ADR-0009, spec 001 section 8).
// Paths are unanchored so the same rules apply to the fixtures in tests/fixtures/arch,
// which prove that every rule fires.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "kernel-and-domain-are-pure",
      comment:
        "kernel, metadata and domain code may only import kernel, metadata or domain code: " +
        "no Node or Bun built-ins, no npm packages, no adapters. The single exception is " +
        "@noble/hashes: pure, audited, dependency-free SHA-256 for the hash contract " +
        "(node:crypto would break purity).",
      severity: "error",
      from: { path: "(^|/)packages/core/src/(kernel|metadata|[^/]+/domain)/" },
      to: {
        pathNot: ["(^|/)packages/core/src/(kernel|metadata|[^/]+/domain)/", "/@noble/hashes/"],
      },
    },
    {
      name: "core-does-not-depend-on-cli",
      comment: "packages/core is the engine; interfaces depend on it, never the reverse.",
      severity: "error",
      from: { path: "(^|/)packages/core/" },
      to: { path: "(^|/)packages/cli/" },
    },
    {
      name: "interfaces-do-not-import-adapters",
      comment:
        "registry, cli and mcp receive adapters through ports; only the composition root " +
        "(main.ts) wires adapters.",
      severity: "error",
      from: { path: "(^|/)packages/cli/src/(registry|cli|mcp)/" },
      to: { path: "(^|/)packages/[^/]+/src/adapters/" },
    },
    {
      name: "no-deep-imports-across-packages",
      comment: "Import another package only through its src/index.ts.",
      severity: "error",
      from: { path: "(^|/)packages/([^/]+)/" },
      to: {
        path: "(^|/)packages/[^/]+/src/(?!index\\.ts$)",
        pathNot: "(^|/)packages/$2/",
      },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      comment: "Every import must resolve (Bun built-ins excepted; they belong in adapters).",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^bun:" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default"],
      extensions: [".ts", ".js"],
    },
  },
};
