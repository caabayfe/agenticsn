// Public API of @snagentic/cli.
export { type CliIo, type CliOptions, runCli } from "./cli/run-cli";
export { createMcpServer } from "./mcp/create-mcp-server";
export { USE_CASES } from "./registry/registry";
export type { UseCase, UseCaseContext } from "./registry/use-case";
export { versionLine } from "./version-line";
