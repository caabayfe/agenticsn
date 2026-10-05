import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/create-mcp-server";
import { MCP_TOOL_BUDGET } from "../../src/registry/mcp-budget";
import type { UseCase } from "../../src/registry/use-case";
import { echoUseCase, FAKE_CONTEXT } from "../support/fakes";

async function connect(useCases: UseCase[]): Promise<Client> {
  const server = createMcpServer(useCases, FAKE_CONTEXT, "test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("generated MCP server", () => {
  it("exposes a use case as a tool with schemas and annotations, with no other code", async () => {
    const { tools } = await (await connect([echoUseCase()])).listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "echo_text",
      description: "Echo text back.",
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toContain("message");
    expect(tools[0]?.outputSchema?.properties).toHaveProperty("echoed");
  });

  it("omits use cases that are not marked for MCP", async () => {
    const useCases = [echoUseCase(), echoUseCase({ name: "cli-only", mcp: false })];
    const { tools } = await (await connect(useCases)).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo_text"]);
  });

  it("returns the output as structured content", async () => {
    const client = await connect([echoUseCase()]);
    const result = await client.callTool({ name: "echo_text", arguments: { message: "hi" } });
    expect(result.structuredContent).toEqual({ echoed: "hi" });
    expect(result.isError).toBeFalsy();
  });

  it("returns a snagentic error as an error result with its code and hint", async () => {
    const client = await connect([echoUseCase()]);
    const result = await client.callTool({ name: "echo_text", arguments: { message: "stale" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "error[stale-mirror]: mirror is stale\nhint: run: snagentic pull" },
    ]);
  });

  it(`refuses to start with more than ${MCP_TOOL_BUDGET} MCP tools`, () => {
    const many = Array.from({ length: MCP_TOOL_BUDGET + 1 }, (_, index) =>
      echoUseCase({ name: `echo-${index}` }),
    );
    expect(() => createMcpServer(many, FAKE_CONTEXT, "test")).toThrow(/budget is 12/);
  });

  it(`accepts exactly ${MCP_TOOL_BUDGET} MCP tools plus any number of CLI-only ones`, () => {
    const mcpTools = Array.from({ length: MCP_TOOL_BUDGET }, (_, index) =>
      echoUseCase({ name: `echo-${index}` }),
    );
    const cliOnly = [echoUseCase({ name: "cli-only", mcp: false })];
    expect(() => createMcpServer([...mcpTools, ...cliOnly], FAKE_CONTEXT, "test")).not.toThrow();
  });
});
