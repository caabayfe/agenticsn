import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "../../src/cli/run-cli";
import { createMcpServer } from "../../src/mcp/create-mcp-server";
import { executeUseCase } from "../../src/registry/execute";
import { MCP_TOOL_BUDGET } from "../../src/registry/mcp-budget";
import { USE_CASES } from "../../src/registry/registry";
import { defineUseCase, qualifiedName } from "../../src/registry/use-case";
import { captureIo, echoUseCase, FAKE_CONTEXT } from "../support/fakes";

describe("use-case registry", () => {
  it("gives the CLI and MCP identical JSON output for the same input", async () => {
    const io = captureIo();
    await runCli(["doctor", "--format", "json"], USE_CASES, FAKE_CONTEXT, io, {
      version: "test",
      serveMcp: async () => {},
    });

    const server = createMcpServer(USE_CASES, FAKE_CONTEXT, "test");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "doctor", arguments: {} });

    expect(JSON.parse(io.out())).toEqual(result.structuredContent);
  });

  it("generators contain no branching on use-case names", async () => {
    const sources = await Promise.all(
      ["src/cli/run-cli.ts", "src/cli/zod-options.ts", "src/mcp/create-mcp-server.ts"].map((file) =>
        Bun.file(`packages/cli/${file}`).text(),
      ),
    );
    for (const { name } of USE_CASES) {
      for (const source of sources) {
        expect(source).not.toContain(`"${name}"`);
        expect(source).not.toContain(`'${name}'`);
      }
    }
  });

  it(`stays within the MCP tool budget of ${MCP_TOOL_BUDGET}`, () => {
    expect(USE_CASES.filter((useCase) => useCase.mcp).length).toBeLessThanOrEqual(MCP_TOOL_BUDGET);
  });

  it("has unique use-case names", () => {
    const names = USE_CASES.map(qualifiedName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects a use-case name that is not kebab-case", () => {
    expect(() => defineUseCase({ ...echoUseCase(), name: "Echo_Text" })).toThrow(/kebab-case/);
  });

  it("rejects handler output that does not match the output schema", async () => {
    const broken = echoUseCase({
      handle: async () => ({ wrong: true }),
    });
    await expect(executeUseCase(broken, { message: "hi" }, FAKE_CONTEXT)).rejects.toThrow(
      /does not match its schema/,
    );
  });
});
