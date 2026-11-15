import { expect, it } from "bun:test";
import { checkMcpConfigs, type WorkspaceFiles } from "../../src/index";

it("checks runtime variables in named JSON profiles and Codex TOML while retaining legacy checks", async () => {
  const texts = new Map([
    [
      "/w/.mcp.json",
      JSON.stringify({
        mcpServers: {
          snagentic: { env: { HTTPS_PROXY: "http://proxy" } },
          "snagentic-investigate": { env: { NODE_OPTIONS: "--import ./file" } },
        },
      }),
    ],
    [
      "/w/.codex/config.toml",
      '[mcp_servers."snagentic-develop".env]\nBUN_OPTIONS = "--preload ./file"\n',
    ],
  ]);
  const files: WorkspaceFiles = {
    read: async (path) => texts.get(path) ?? null,
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const configs = [{ path: ".mcp.json", key: "mcpServers", name: "snagentic-investigate" }];
  const result = await checkMcpConfigs(files, "/w", configs, Bun.TOML.parse);
  expect(result.status).toBe("fail");
  expect(result.detail).toContain("NODE_OPTIONS");
  expect(result.detail).toContain("HTTPS_PROXY");
  expect(result.detail).toContain(".codex/config.toml sets BUN_OPTIONS");
  texts.delete("/w/.mcp.json");
  for (const text of [
    '[mcp_servers.other.env]\nNODE_OPTIONS = "unrelated"\n',
    '[unrelated]\nsetting = "value"\n',
    "broken = [",
  ]) {
    texts.set("/w/.codex/config.toml", text);
    expect((await checkMcpConfigs(files, "/w", configs, Bun.TOML.parse)).status).toBe("ok");
  }
});
