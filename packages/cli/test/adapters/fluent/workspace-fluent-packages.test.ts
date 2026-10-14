import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import { WorkspaceFluentPackages } from "../../../src/adapters/fluent/workspace-fluent-packages";
import { WorkspaceFluentProjects } from "../../../src/adapters/fluent/workspace-fluent-projects";
import { fluentWorkspace } from "../../support/fluent-fixtures";

const BUILD_TIMEOUT = 60_000;
const PROJECT = "source/x_2222332_s11";
const FLOW_FILE = join(PROJECT, "src/fluent/s11-flow.now.ts");

async function packagesOf(root: string) {
  const projects = new WorkspaceFluentProjects(root, loadFluentRuntime);
  return new WorkspaceFluentPackages(root, projects, loadFluentRuntime).changedSince("HEAD");
}

describe("workspace Fluent packages", () => {
  it(
    "builds each changed project into its update XML, with its scope and a stable digest",
    async () => {
      const root = await fluentWorkspace(PROJECT);
      expect(await packagesOf(root)).toEqual([]);
      const flow = join(root, FLOW_FILE);
      writeFileSync(flow, readFileSync(flow, "utf8").replace("(v5)", "(v6)"));
      const [first] = await packagesOf(root);
      expect(first).toMatchObject({
        project: PROJECT,
        scope: "x_2222332_s11",
        scopeId: "489da54ae67c4a3e9f1e1e4347e9119b",
        configuration: false,
      });
      expect(first?.files.map((f) => f.name)).toContain(
        "sys_hub_flow_8a924849cd84412081573bb363ec4326.xml",
      );
      // The SBOM's serial number and build time change on every build; the digest does not.
      const [again] = await packagesOf(root);
      expect(again?.digest).toBe(first?.digest ?? "");
      writeFileSync(flow, readFileSync(flow, "utf8").replace("(v6)", "(v7)"));
      const [edited] = await packagesOf(root);
      expect(edited?.digest).not.toBe(first?.digest ?? "");
    },
    BUILD_TIMEOUT,
  );

  it(
    "leaves out a project that does not build (validate reports why)",
    async () => {
      const root = await fluentWorkspace(PROJECT);
      writeFileSync(
        join(root, PROJECT, "src/fluent/broken.now.ts"),
        "export const x: number = 'no'\n",
      );
      expect(await packagesOf(root)).toEqual([]);
    },
    BUILD_TIMEOUT,
  );
});
