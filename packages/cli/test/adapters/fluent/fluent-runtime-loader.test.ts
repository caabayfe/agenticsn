import { describe, expect, it } from "bun:test";
import {
  EMBEDDED_FLUENT_ENTRY,
  loadEmbeddedRuntime,
} from "../../../src/adapters/fluent/fluent-runtime-loader";
import { createFluentRuntime } from "../../../src/adapters/fluent/sdk-runtime";

describe("Fluent runtime loader", () => {
  it("takes the runtime the binary's second entry point exports", async () => {
    const runtime = createFluentRuntime(new Map());
    const requested: string[] = [];
    const loaded = await loadEmbeddedRuntime(async (specifier) => {
      requested.push(specifier);
      return { runtime };
    });
    expect(loaded).toBe(runtime);
    expect(requested).toEqual([`./${EMBEDDED_FLUENT_ENTRY}.js`]);
  });

  it("refuses a second entry point without a usable runtime", async () => {
    for (const module of [{}, null, { runtime: { sdkVersion: "1" } }]) {
      await expect(loadEmbeddedRuntime(async () => module)).rejects.toThrow("incomplete");
    }
  });

  it("fails when run from source, where the binary's second entry point does not exist", async () => {
    await expect(loadEmbeddedRuntime()).rejects.toThrow();
  });

  it("names the SDK version unknown when its package.json is not embedded", () => {
    expect(createFluentRuntime(new Map()).sdkVersion).toBe("unknown");
  });
});
