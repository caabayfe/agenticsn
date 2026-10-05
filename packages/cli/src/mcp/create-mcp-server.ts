import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { describeError, executeUseCase, type RunControl } from "../registry/execute";
import { assertMcpBudget } from "../registry/mcp-budget";
import { mcpToolName, type UseCase, type UseCaseContext } from "../registry/use-case";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// Maps MCP cancellation and progress onto the use case's run control. Progress is only
// sent when the client asked for it with a progress token, and always increases.
function runControlFor(extra: ToolExtra): RunControl {
  const token = extra._meta?.progressToken;
  let step = 0;
  return {
    signal: extra.signal,
    progress: (event) => {
      step = Math.max(step + 1, event.completed ?? 0);
      if (token === undefined) {
        return;
      }
      void extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: step,
          message: event.message,
          ...(event.total === undefined ? {} : { total: event.total }),
        },
      });
    },
  };
}

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
      async (args, extra) => {
        try {
          const { output } = await executeUseCase(useCase, args, context, runControlFor(extra));
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
