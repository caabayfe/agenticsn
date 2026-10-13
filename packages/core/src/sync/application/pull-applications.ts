import { AccessDeniedError } from "../../index-errors";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { renderRecord } from "../../metadata/domain/record-layout";
import type { IncrementalMirror } from "../ports";
import type { PullDependencies } from "./pull-dependencies";

export interface ApplicationsOutcome {
  readonly applications: number;
  readonly unreadable: readonly string[];
}

const SYS_APP = "sys_app";

// Custom applications are not sys_metadata, so no change feed sees them: every pull lists them
// whole, a handful of rows (ADR-0025). Each is a record of its own scope, whose sys_id is the
// application's. With `stale`, files of applications no longer listed (renamed or deleted)
// are removed.
export async function pullApplications(
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
  stale?: Pick<IncrementalMirror, "filesOf" | "remove">,
): Promise<ApplicationsOutcome> {
  const listing = {
    table: TableName.parse(SYS_APP),
    fields: "all" as const,
    kind: "snapshot" as const,
    base: "",
  };
  const written = new Set<string>();
  try {
    for await (const row of deps.pager.rows(listing, signal)) {
      const sysId = row["sys_id"] ?? "";
      const own = { ...row, sys_class_name: SYS_APP, sys_scope: sysId };
      const scoped = catalog.withScope(sysId, row["scope"] ?? "");
      const rendered = renderRecord(artifactFromRow(own, scoped, deps.policy), scoped);
      await deps.records.write(deps.metadataRoot, rendered);
      written.add(rendered.base);
    }
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      throw error;
    }
    return { applications: 0, unreadable: [SYS_APP] };
  }
  if (stale !== undefined) {
    await removeOthers(deps, stale, written);
  }
  return { applications: written.size, unreadable: [] };
}

// Removes the files of applications the instance no longer lists under that name.
async function removeOthers(
  deps: PullDependencies,
  stale: Pick<IncrementalMirror, "filesOf" | "remove">,
  listed: ReadonlySet<string>,
): Promise<void> {
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    if (base.includes(`/${SYS_APP}/`) && !listed.has(base)) {
      for (const file of stale.filesOf(deps.metadataRoot, base)) {
        await stale.remove(deps.metadataRoot, file);
      }
    }
  }
}
