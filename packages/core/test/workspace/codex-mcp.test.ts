import { expect, it } from "bun:test";
import { withCodexMcp } from "../../src/workspace/domain/codex-mcp";

const servers = {
  "snagentic-investigate": { command: "snagentic", args: ["mcp", "--profile", "investigate"] },
};
it("merges Codex project MCP entries without changing unrelated TOML or customized entries", () => {
  const existing = 'model = "mine"\n[mcp_servers.other]\ncommand = "other"\n';
  const merged = withCodexMcp(existing, servers, Bun.TOML.parse);
  expect(merged).toStartWith(existing);
  expect(Bun.TOML.parse(merged ?? "")).toMatchObject({ model: "mine", mcp_servers: servers });
  expect(withCodexMcp(merged, servers, Bun.TOML.parse)).toBe(merged);
  const custom = '[mcp_servers."snagentic-investigate"]\ncommand = "custom"\n';
  expect(withCodexMcp(custom, servers, Bun.TOML.parse)).toBeNull();
  expect(withCodexMcp("invalid = [", servers, Bun.TOML.parse)).toBeNull();
});
