import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAIN = "packages/cli/src/main.ts";

async function snagentic(...args: string[]) {
  const child = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("snagentic entry point (real adapters)", () => {
  it("prints its version", async () => {
    expect(await snagentic("--version")).toMatchObject({
      exitCode: 0,
      stdout: "snagentic 0.0.0\n",
    });
  });

  it("runs doctor with the real local checks", async () => {
    const { exitCode, stdout } = await snagentic("doctor", "--format", "json");
    const report = JSON.parse(stdout);
    expect(report.checks.map((check: { name: string }) => check.name)).toEqual([
      "git",
      "keychain",
      "search-index",
    ]);
    expect(exitCode).toBe(report.ok ? 0 : 3);
  });

  it("serves doctor as an MCP tool over stdio", async () => {
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "bun", args: [MAIN, "mcp"] }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["doctor", "pull"]);
      const result = await client.callTool({ name: "doctor", arguments: {} });
      expect(result.structuredContent).toHaveProperty("checks");
    } finally {
      await client.close();
    }
  });
});
