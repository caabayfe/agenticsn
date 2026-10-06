import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

// ADR-0012 layer 3: a tool that changes an instance exists only when the workspace has a
// development instance, and can only name those. For other kinds it is not registered at all.
function toolInput(useCase: UseCase, developmentInstances: readonly string[]): z.ZodObject | null {
  if (!useCase.flags.requiresDevelopmentInstance) {
    return useCase.input;
  }
  const [first, ...rest] = developmentInstances;
  return first === undefined ? null : useCase.input.extend({ instance: z.enum([first, ...rest]) });
}

// What the agent pack contributes (spec 003): always-loaded instructions, and the workflows
// offered as prompts (slash commands in hosts that show them).
export interface AgentInterface {
  readonly instructions: string;
  readonly prompts: readonly {
    readonly name: string;
    readonly description: string;
    readonly message: (request: string) => string;
  }[];
}

function registerPrompts(server: McpServer, prompts: AgentInterface["prompts"]): void {
  for (const prompt of prompts) {
    server.registerPrompt(
      prompt.name,
      {
        description: prompt.description,
        argsSchema: { request: z.string().describe("what the user wants, in their words") },
      },
      ({ request }) => ({
        messages: [{ role: "user", content: { type: "text", text: prompt.message(request) } }],
      }),
    );
  }
}

// Builds the MCP server from the registry. Contains no knowledge of any specific use case.
export function createMcpServer(
  useCases: readonly UseCase[],
  context: UseCaseContext,
  version: string,
  developmentInstances: readonly string[] = [],
  agent: AgentInterface = { instructions: "", prompts: [] },
): McpServer {
  assertMcpBudget(useCases);
  const server = new McpServer(
    { name: "snagentic", version },
    agent.instructions === "" ? {} : { instructions: agent.instructions },
  );
  registerPrompts(server, agent.prompts);
  for (const useCase of useCases.filter((candidate) => candidate.mcp)) {
    const inputSchema = toolInput(useCase, developmentInstances);
    if (inputSchema === null) {
      continue;
    }
    server.registerTool(
      mcpToolName(useCase),
      {
        description: useCase.description,
        inputSchema,
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
