import type { UseCase } from "./use-case";

// ADR-0002: at most 12 task-level MCP tools, to keep the agent's standing context small.
// 13 since ADR-0026 (the read-only accelerator tool).
export const MCP_TOOL_BUDGET = 13;

export function assertMcpBudget(useCases: readonly UseCase[]): void {
  const exposed = useCases.filter((useCase) => useCase.mcp);
  if (exposed.length > MCP_TOOL_BUDGET) {
    throw new Error(
      `${exposed.length} use cases are marked for MCP; the budget is ${MCP_TOOL_BUDGET} (ADR-0002)`,
    );
  }
}
