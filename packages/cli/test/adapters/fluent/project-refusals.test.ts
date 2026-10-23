import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LoadFluentRuntime,
  loadFluentRuntime,
  loadInProcessRuntime,
} from "../../../src/adapters/fluent/fluent-runtime-loader";
import { copyFixture, FLUENT_FIXTURES } from "../../support/fluent-fixtures";

// Builds run the real SDK in-process: about a second each.
const BUILD_TIMEOUT = 60_000;

// A workspace is not trusted input: a cloned repository, a pull request or an agent's edit can
// put anything in it, and the hooks build it unasked. These projects are refused before the SDK
// sees them (spec 012, B-01, B-03, B-15).
const MARKER = "config-ran.txt";
const planted = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./${MARKER}", import.meta.url), "x");\nexport default {};\n`;

const project = () => copyFixture(join(FLUENT_FIXTURES, "server-modules"));

function withConfig(dir: string, change: Record<string, unknown>): void {
  const path = join(dir, "now.config.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...change }));
}

// Run both ways: through the worker snagentic uses (ADR-0044), and in-process, where coverage
// sees the refusals.
const RUNTIMES: readonly (readonly [string, LoadFluentRuntime])[] = [
  ["in the worker", loadFluentRuntime],
  ["in-process", loadInProcessRuntime],
];

describe.each(RUNTIMES)("projects the embedded build refuses (%s)", (_, load) => {
  for (const file of ["prettier.config.mjs", "src/fluent/.prettierrc.cjs", ".prettierrc.js"]) {
    it(
      `refuses a Prettier config that is code (${file}), without running it`,
      async () => {
        const dir = project();
        mkdirSync(join(dir, file, ".."), { recursive: true });
        writeFileSync(join(dir, file), planted);
        const outcome = await (await load()).build(dir);
        expect(outcome).toEqual({
          success: false,
          errors: [expect.objectContaining({ file, code: "snagentic-project-formatter" })],
        });
        expect(existsSync(join(dir, file, "..", MARKER))).toBe(false);
      },
      BUILD_TIMEOUT,
    );
  }

  it(
    "never runs a Prettier config planted in a folder above the project",
    async () => {
      const dir = project();
      // The project sits in a scratch folder, as a build copy sits in the shared temp folder.
      writeFileSync(join(dir, "..", "prettier.config.mjs"), planted);
      expect((await (await load()).build(dir)).success).toBe(true);
      expect(existsSync(join(dir, "..", MARKER))).toBe(false);
    },
    BUILD_TIMEOUT,
  );

  it(
    "builds a project whose Prettier config is data",
    async () => {
      const dir = project();
      writeFileSync(join(dir, ".prettierrc.json"), '{ "singleQuote": true }');
      expect((await (await load()).build(dir)).success).toBe(true);
    },
    BUILD_TIMEOUT,
  );

  it(
    "refuses folders in now.config.json that leave the project, and deletes nothing there",
    async () => {
      const dir = project();
      const victim = mkdtempSync(join(tmpdir(), "snagentic-victim-"));
      writeFileSync(join(victim, "keep.txt"), "keep");
      withConfig(dir, {
        packOutputDir: `${"../".repeat(30)}${victim.slice(1)}`,
        appOutputDir: victim,
        staticContent: { buildDir: "dist/../../elsewhere" },
      });
      const outcome = await (await load()).build(dir);
      expect(outcome.success).toBe(false);
      const errors = outcome.success ? [] : outcome.errors;
      expect(errors.map((e) => [e.file, e.code, e.message.split(" ")[0]])).toEqual([
        ["now.config.json", "snagentic-project-path", "staticContent.buildDir"],
        ["now.config.json", "snagentic-project-path", "appOutputDir"],
        ["now.config.json", "snagentic-project-path", "packOutputDir"],
      ]);
      expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("keep");
    },
    BUILD_TIMEOUT,
  );

  it(
    "refuses a project holding a symbolic link",
    async () => {
      const dir = project();
      symlinkSync(tmpdir(), join(dir, "src", "fluent", "elsewhere"));
      const outcome = await (await load()).build(dir);
      expect(outcome).toEqual({
        success: false,
        errors: [
          expect.objectContaining({
            file: "src/fluent/elsewhere",
            code: "snagentic-project-link",
          }),
        ],
      });
    },
    BUILD_TIMEOUT,
  );

  it(
    "refuses to transform into a refused project, before asking the instance anything",
    async () => {
      const dir = project();
      writeFileSync(join(dir, "prettier.config.mjs"), planted);
      const outcome = await (await load()).transform(
        dir,
        [{ table: "sys_script_include", sysId: "0".repeat(32) }],
        "https://instance.example.com/",
        () => Promise.reject(new Error("asked the instance")),
      );
      expect(outcome).toEqual({
        success: false,
        message: expect.stringContaining("prettier.config.mjs"),
      });
      expect(existsSync(join(dir, MARKER))).toBe(false);
    },
    BUILD_TIMEOUT,
  );
});
