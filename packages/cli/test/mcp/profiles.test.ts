import { expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PROMPTS } from "@snagentic/agent-packs";
import { createMcpServer } from "../../src/mcp/create-mcp-server";
import { profileUseCases } from "../../src/registry/mcp-profile";
import { queryTable } from "../../src/registry/query-table";
import { USE_CASES } from "../../src/registry/registry";
import { FAKE_CONTEXT } from "../support/fakes";

async function tools(profile: "investigate" | "develop", development: string[]) {
  const server = createMcpServer(
    USE_CASES,
    FAKE_CONTEXT,
    "test",
    development,
    { instructions: "", prompts: PROMPTS },
    profile,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "profile-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.listTools();
  const { prompts } = await client.listPrompts();
  await client.close();
  return { tools: result.tools, prompts };
}

it("investigation exposes bounded reads and never exposes instance writes even with development profiles", async () => {
  expect(() =>
    profileUseCases(
      [{ ...queryTable, flags: { ...queryTable.flags, readOnly: false } }],
      "investigate",
    ),
  ).toThrow("read-only");
  const { tools: result, prompts } = await tools("investigate", ["dev"]);
  expect(prompts.map((prompt) => prompt.name)).toEqual(["explain", "troubleshoot"]);
  expect(result.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "query_table",
      "get_record",
      "aggregate",
      "table_schema",
      "find",
      "describe",
    ]),
  );
  expect(result.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
  expect(result.map((tool) => tool.name)).not.toContain("push");
  expect(result.length).toBeLessThanOrEqual(13);
});

it("development keeps gated delivery and omits development-only tools without a development profile", async () => {
  const development = await tools("develop", ["dev"]);
  const dev = development.tools.map((tool) => tool.name);
  expect(development.prompts.map((prompt) => prompt.name)).not.toContain("troubleshoot");
  expect(dev).toEqual(expect.arrayContaining(["adopt", "plan_push", "push", "validate", "advise"]));
  expect(dev).not.toContain("query_table");
  const production = (await tools("develop", [])).tools.map((tool) => tool.name);
  expect(production).not.toContain("push");
  expect(production).not.toContain("adopt");
  expect(dev.length).toBeLessThanOrEqual(13);
});
