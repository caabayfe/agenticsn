import { describe, expect, it } from "bun:test";
import type { FluentProject, FluentProjects } from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { fluentKeys } from "../../src/registry/fluent-keys";
import { USE_CASES } from "../../src/registry/registry";
import { FAKE_CONTEXT } from "../support/fakes";

const project = (path: string): FluentProject => ({ path, declaredSdk: "4.13.6" });

describe("fluent-keys (P5, spec 005)", () => {
  it("builds the staged projects when asked, writes their keys, and names the new IDs", async () => {
    const opened: unknown[] = [];
    const written: string[] = [];
    const projects: FluentProjects = {
      changedSince: async () => [project("source/global")],
      holding: async (paths) => paths.map((p) => project(p.split("/").slice(0, 2).join("/"))),
      build: async () => ({
        built: true,
        keys: {
          committed: null,
          built: "explicit: {\n  page_on_call: {\n    table: 'sys_hub_flow'",
        },
        deletes: [],
      }),
      sdkVersion: async () => "4.13.6",
      writeKeys: async (p) => {
        written.push(p.path);
      },
    };
    const context = {
      ...FAKE_CONTEXT,
      workspaces: {
        ...FAKE_CONTEXT.workspaces,
        readManifest: async () => ({ layout: 1, createdWith: "test" }),
      },
      fluentProjects: (_root: string, options?: { readonly staged?: boolean }) => {
        opened.push(options);
        return projects;
      },
    };
    const { output } = await executeUseCase(fluentKeys, { staged: true }, context);
    expect(opened).toEqual([{ staged: true }]);
    expect(output).toEqual({
      projects: 1,
      written: [{ path: "source/global", added: ["page_on_call"] }],
      notBuilt: [],
    });
    expect(fluentKeys.render(output as never, "text")).toBe(
      "source/global: keys.ts gains page_on_call",
    );
    await executeUseCase(fluentKeys, { paths: ["source/x_app/src/fluent/a.now.ts"] }, context);
    expect(written).toEqual(["source/global", "source/x_app"]);
  });

  it("leaves projects that do not build to validate, and says nothing when nothing changed", () => {
    const output = { projects: 1, written: [], notBuilt: ["source/x_app"] };
    expect(fluentKeys.render(output, "text")).toBe(
      "source/x_app: does not build, keys not written (snagentic validate)",
    );
    expect(fluentKeys.exitCode(output)).toBe(0);
    expect(fluentKeys.render({ projects: 0, written: [], notBuilt: [] }, "text")).toBe("");
  });

  it("is a command only: no MCP tool, no instance", () => {
    expect(USE_CASES).toContain(fluentKeys);
    expect(fluentKeys.mcp).toBe(false);
    expect(fluentKeys.flags.requiresDevelopmentInstance).toBe(false);
  });
});
