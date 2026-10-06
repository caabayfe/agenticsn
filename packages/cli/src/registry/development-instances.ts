import { listInstances } from "@snagentic/core";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The development instances of the workspace the MCP server starts in; none outside one.
export async function developmentInstances(context: UseCaseContext): Promise<string[]> {
  try {
    const profiles = await listInstances(await workspaceRoot(context), context.profiles);
    return profiles
      .filter((profile) => profile.kind === "development")
      .map((profile) => profile.name);
  } catch {
    return [];
  }
}
