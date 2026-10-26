import type { Row } from "../../kernel/row";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { renderRecord } from "../../metadata/domain/record-layout";
import type { SecretPatternId } from "../../metadata/domain/secret-scan";
import { isChildRowFile } from "../domain/record-changes";
import type { IncrementalDependencies } from "./incremental-dependencies";

export interface ReplacedRecord {
  readonly kind: "written" | "renamed";
  readonly base: string;
  readonly created: boolean;
  readonly secretPatterns: readonly SecretPatternId[];
}

// Replaces a record while preserving child-row files across a name change.
export async function replaceRecord(
  deps: IncrementalDependencies,
  catalog: Catalog,
  row: Row,
): Promise<ReplacedRecord> {
  const rendered = renderRecord(artifactFromRow(row, catalog, deps.policy), catalog);
  const root = deps.metadataRoot;
  const previous = deps.records.baseOf(root, row["sys_id"] ?? "");
  for (const path of previous === undefined ? [] : deps.records.filesOf(root, previous)) {
    if (!isChildRowFile(previous ?? "", path)) {
      await deps.records.remove(root, path);
    } else if (previous !== rendered.base) {
      await deps.records.move(root, path, rendered.base + path.slice((previous ?? "").length));
    }
  }
  await deps.records.write(root, rendered);
  return {
    kind: previous === undefined || previous === rendered.base ? "written" : "renamed",
    base: rendered.base,
    created: previous === undefined,
    secretPatterns: rendered.secretPatterns,
  };
}
