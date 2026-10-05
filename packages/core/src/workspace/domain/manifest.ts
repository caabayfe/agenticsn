import { WorkspaceLayoutError } from "./errors";

// Version of the on-disk layout (ADR-0014). Changing the layout means a new version and a
// `snagentic migrate` step; layouts are never changed silently.
export const LAYOUT_VERSION = 1;
export const MANIFEST_FILE = "snagentic.yaml";

export interface WorkspaceManifest {
  readonly layout: number;
  readonly createdWith: string;
}

export function manifestFor(createdWith: string): WorkspaceManifest {
  return { layout: LAYOUT_VERSION, createdWith };
}

function layoutOf(manifest: unknown): number | undefined {
  if (manifest === null || typeof manifest !== "object" || !("layout" in manifest)) {
    return undefined;
  }
  return typeof manifest.layout === "number" ? manifest.layout : undefined;
}

// Validates a parsed manifest. Adapters parse the file; this decides whether it is usable.
export function checkLayout(manifest: unknown): WorkspaceManifest {
  const layout = layoutOf(manifest);
  if (layout !== undefined && layout > LAYOUT_VERSION) {
    throw new WorkspaceLayoutError(
      `this workspace uses layout ${layout}, newer than this snagentic supports (${LAYOUT_VERSION})`,
      "upgrade snagentic",
    );
  }
  if (layout !== LAYOUT_VERSION) {
    throw new WorkspaceLayoutError(
      "this workspace uses an older or unreadable layout",
      "run `snagentic migrate` to update it",
    );
  }
  const createdWith =
    manifest !== null && typeof manifest === "object" && "createdWith" in manifest
      ? String(manifest.createdWith)
      : "unknown";
  return { layout, createdWith };
}
