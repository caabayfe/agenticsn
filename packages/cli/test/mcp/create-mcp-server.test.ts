import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/create-mcp-server";
import { MCP_TOOL_BUDGET } from "../../src/registry/mcp-budget";
import type { UseCase } from "../../src/registry/use-case";
import { echoUseCase, FAKE_CONTEXT, progressUseCase, waitForCancelUseCase } from "../support/fakes";

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

  it("sends progress notifications when the client asks for progress", async () => {
    const client = await connect([progressUseCase()]);
    const received: unknown[] = [];
    await client.callTool({ name: "progress_steps", arguments: { message: "x" } }, undefined, {
      onprogress: (progress) => received.push(progress),
    });
    expect(received).toEqual([
      { progress: 1, total: 2, message: "reading catalog" },
      { progress: 2, total: 2, message: "writing records" },
    ]);
  });

  it("aborts the handler when the client cancels the call", async () => {
    let started: () => void = () => {};
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let sawAbort: () => void = () => {};
    const handlerAborted = new Promise<void>((resolve) => {
      sawAbort = resolve;
    });
    const client = await connect([
      waitForCancelUseCase(
        () => started(),
        () => sawAbort(),
      ),
    ]);
    const controller = new AbortController();
    const call = client
      .callTool({ name: "wait_for_cancel", arguments: { message: "x" } }, undefined, {
        signal: controller.signal,
      })
      .catch((error: unknown) => error);
    await handlerStarted;
    controller.abort();
    expect(await call).toBeInstanceOf(Error);
    await handlerAborted;
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
