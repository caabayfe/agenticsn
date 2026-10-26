import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadInProcessRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import {
  copyFixture,
  FLUENT_ERRORS_FIXTURE,
  FLUENT_FIXTURES,
  KEYS_FILE,
  normalizedRecords,
} from "../../support/fluent-fixtures";

// What the SDK builds, checked with the SDK loaded in-process: the worker that runs it in
// snagentic (ADR-0044) is tested in worker-runtime.test.ts. About a second each.
const BUILD_TIMEOUT = 60_000;

describe("embedded Fluent build", () => {
  it("names the SDK version it builds with", async () => {
    expect((await loadInProcessRuntime()).sdkVersion).toBe("4.13.6");
  });

  for (const fixture of ["s11-flows", "server-modules", "kitchen-sink"]) {
    it(
      `builds ${fixture} as the now-sdk CLI does and leaves its keys.ts unchanged`,
      async () => {
        const source = join(FLUENT_FIXTURES, fixture);
        const project = copyFixture(source);
        const outcome = await (await loadInProcessRuntime()).build(project);
        expect(outcome.success).toBe(true);
        expect(normalizedRecords(join(project, "dist", "app"))).toEqual(
          normalizedRecords(join(source, "expected")),
        );
        expect(readFileSync(join(project, KEYS_FILE), "utf8")).toBe(
          readFileSync(join(source, KEYS_FILE), "utf8"),
        );
      },
      BUILD_TIMEOUT,
    );
  }

  it(
    "reports each error of a failed build with its file, line, column and code",
    async () => {
      const outcome = await (await loadInProcessRuntime()).build(
        copyFixture(FLUENT_ERRORS_FIXTURE),
      );
      if (outcome.success) throw new Error("the errors fixture built");
      expect(outcome.errors).toContainEqual(
        expect.objectContaining({
          file: "src/fluent/unknown-action.now.ts",
          line: 9,
          column: 25,
          code: "ts2551",
        }),
      );
      const codes = new Set(outcome.errors.map((e) => e.code));
      expect([...codes].sort()).toEqual(["fluent213", "ts2339", "ts2345", "ts2551", "ts2769"]);
    },
    BUILD_TIMEOUT,
  );

  it(
    "says why a build failed when the SDK reports no diagnostic, as for a record defined twice",
    async () => {
      const project = copyFixture(join(FLUENT_FIXTURES, "accelerator-records"));
      const records = join(project, "src", "fluent", "records.now.ts");
      writeFileSync(join(project, "src", "fluent", "copy.now.ts"), readFileSync(records, "utf8"));
      const outcome = await (await loadInProcessRuntime()).build(project);
      if (outcome.success) throw new Error("a record defined twice built");
      expect(outcome.errors.length).toBeGreaterThan(0);
      expect(outcome.errors.every((e) => e.message.trim() !== "")).toBe(true);
    },
    BUILD_TIMEOUT,
  );

  // A project's build scripts would run inside snagentic, which holds the instance's
  // credentials (security finding S1): snagentic refuses the build and never runs them.
  const MARKER = "script-ran.txt";
  const script = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./${MARKER}", import.meta.url), "x");\nexport default [];\n`;

  for (const name of ["now.prebuild.mjs", "now.postbuild.mjs"]) {
    it(
      `refuses to build a project with ${name}, without running it`,
      async () => {
        const project = copyFixture(join(FLUENT_FIXTURES, "server-modules"));
        writeFileSync(join(project, name), script);
        const outcome = await (await loadInProcessRuntime()).build(project);
        expect(outcome).toEqual({
          success: false,
          errors: [expect.objectContaining({ file: name, code: "snagentic-project-script" })],
        });
        expect(existsSync(join(project, MARKER))).toBe(false);
      },
      BUILD_TIMEOUT,
    );
  }

  it(
    "refuses a build script named in now.config.json, without running it",
    async () => {
      const project = copyFixture(join(FLUENT_FIXTURES, "server-modules"));
      const configPath = join(project, "now.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      writeFileSync(configPath, JSON.stringify({ ...config, scripts: { prebuild: "./b.mjs" } }));
      writeFileSync(join(project, "b.mjs"), script);
      const outcome = await (await loadInProcessRuntime()).build(project);
      expect(outcome).toEqual({
        success: false,
        errors: [
          expect.objectContaining({ file: "now.config.json", code: "snagentic-project-script" }),
        ],
      });
      expect(existsSync(join(project, MARKER))).toBe(false);
    },
    BUILD_TIMEOUT,
  );
});
