import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeError, executeUseCase } from "../registry/execute";
import { assertMcpBudget } from "../registry/mcp-budget";
import { mcpToolName, type UseCase, type UseCaseContext } from "../registry/use-case";

// Builds the MCP server from the registry. Contains no knowledge of any specific use case.
export function createMcpServer(
  useCases: readonly UseCase[],
  context: UseCaseContext,
  version: string,
): McpServer {
  assertMcpBudget(useCases);
  const server = new McpServer({ name: "snagentic", version });
  for (const useCase of useCases.filter((candidate) => candidate.mcp)) {
    server.registerTool(
      mcpToolName(useCase),
      {
        description: useCase.description,
        inputSchema: useCase.input,
        outputSchema: useCase.output,
        annotations: {
          readOnlyHint: useCase.flags.readOnly,
          destructiveHint: useCase.flags.destructive,
        },
      },
      async (args) => {
        try {
          const { output } = await executeUseCase(useCase, args, context);
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          const { code, message, hint } = describeError(error);
          return {
            isError: true,
            content: [{ type: "text", text: `error[${code}]: ${message}\nhint: ${hint}` }],
          };
        }
      },
    );
  }
  return server;
}
