import { doctor } from "./doctor";
import { init } from "./init";
import type { UseCase } from "./use-case";

// Every operation snagentic offers. Adding one here adds its CLI command and, when marked
// `mcp: true`, its MCP tool.
export const USE_CASES: readonly UseCase[] = [init, doctor];
