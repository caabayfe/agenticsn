import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import {
  copyFixture,
  FLUENT_ERRORS_FIXTURE,
  FLUENT_FIXTURES,
  KEYS_FILE,
  normalizedRecords,
} from "../../support/fluent-fixtures";

// Builds run the real SDK in-process: about a second each.
const BUILD_TIMEOUT = 60_000;

describe("embedded Fluent build", () => {
  it("names the SDK version it builds with", async () => {
    expect((await loadFluentRuntime()).sdkVersion).toBe("4.13.6");
  });

  for (const fixture of ["s11-flows", "server-modules", "kitchen-sink"]) {
    it(
      `builds ${fixture} as the now-sdk CLI does and leaves its keys.ts unchanged`,
      async () => {
        const source = join(FLUENT_FIXTURES, fixture);
        const project = copyFixture(source);
        const outcome = await (await loadFluentRuntime()).build(project);
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
      const outcome = await (await loadFluentRuntime()).build(copyFixture(FLUENT_ERRORS_FIXTURE));
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
});
