import type { UseCase } from "./use-case";

export const MCP_PROFILES = ["legacy", "investigate", "develop"] as const;
export type McpProfile = (typeof MCP_PROFILES)[number];

export function profileUseCases(useCases: readonly UseCase[], profile: McpProfile): UseCase[] {
  const selected = useCases.filter((useCase) =>
    profile === "legacy" ? useCase.mcp : useCase.mcpProfiles?.includes(profile) === true,
  );
  if (profile === "investigate" && selected.some((useCase) => !useCase.flags.readOnly)) {
    throw new Error("investigate MCP may expose only read-only use cases (ADR-0057)");
  }
  return selected.map((useCase) => ({ ...useCase, mcp: true }));
}
