import { afterEach, describe, expect, it } from "bun:test";
import { InstanceName } from "@snagentic/core";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { executeUseCase } from "../../src/registry/execute";
import { pluginsList } from "../../src/registry/plugins-list";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function pulledWorkspace() {
  const ws = await instanceWorkspace({});
  cleanups.push(ws.cleanup);
  const mirror = await GitMirror.open(ws.root, InstanceName.parse("pdi"), "fresh");
  await mirror.writeDocument("instances/pdi/operational", "plugins.yaml", [
    {
      id: "com.glide.hub",
      name: "Flow Designer",
      active: "inactive",
      version: "1.0",
      scope: "global",
    },
    {
      id: "com.snc.incident_ai",
      name: "Incident AI",
      active: "active",
      version: "2.0",
      scope: "global",
    },
  ]);
  await mirror.writeDocument("instances/pdi/operational", "store_apps.yaml", [
    {
      scope: "sn_vsc",
      name: "Vulnerability",
      version: "29.0",
      active: "true",
      vendor: "ServiceNow",
    },
  ]);
  await mirror.finish("pull");
  return ws;
}

describe("plugins list", () => {
  it("lists plugins and store apps from the pulled inventory, without calling the instance", async () => {
    const { context, instance } = await pulledWorkspace();
    const { output } = await executeUseCase(
      pluginsList,
      { instance: "pdi", text: "incident" },
      context,
    );
    expect(output["plugins"]).toEqual([
      {
        id: "com.snc.incident_ai",
        name: "Incident AI",
        active: true,
        version: "2.0",
        scope: "global",
      },
    ]);
    expect(instance.queries).toEqual([]);
    const text = pluginsList.render(output as never, "text");
    expect(text).toContain("1 plugins, 0 store apps");
    expect(text).toContain("plugin     active    2.0         com.snc.incident_ai  (Incident AI)");
  });

  it("lists store apps by state", async () => {
    const { context } = await pulledWorkspace();
    const { output } = await executeUseCase(
      pluginsList,
      { instance: "pdi", state: "active" },
      context,
    );
    expect(pluginsList.render(output as never, "text")).toContain(
      "store app  active    29.0        sn_vsc  (Vulnerability)",
    );
  });

  it("says to pull first when there is no inventory yet", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await expect(
      executeUseCase(pluginsList, { instance: "pdi" }, ws.context),
    ).rejects.toMatchObject({
      code: "nothing-pulled",
    });
  });

  it("points out long lists can be narrowed", () => {
    const plugins = Array.from({ length: 205 }, (_, i) => ({
      id: `p${i}`,
      name: "x",
      active: true,
      version: "1",
      scope: "global",
    }));
    const text = pluginsList.render(
      { instance: "pdi", asOf: null, plugins, storeApps: [] },
      "text",
    );
    expect(text).toContain("... and 5 more; narrow with a search text or --state");
  });
});
