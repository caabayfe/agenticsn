import { WorkspaceLayoutError } from "./errors";

// Version of the on-disk layout (ADR-0014); layouts are never changed silently. Layout 2 adds the
// Fluent source under source/<scope>/ and makes the mirror read-only (ADR-0031).
export const LAYOUT_VERSION = 2;
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
      "this workspace uses an older or unreadable layout: layout 1 kept changes as mirrored YAML, before Fluent source (ADR-0031)",
      "create a new workspace with snagentic init, add the instances, pull, and adopt the records to change",
    );
  }
  const createdWith =
    manifest !== null && typeof manifest === "object" && "createdWith" in manifest
      ? String(manifest.createdWith)
      : "unknown";
  return { layout, createdWith };
}
