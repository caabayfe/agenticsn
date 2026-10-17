import type { Finding } from "../domain/findings";
import type { DocumentedRecords, RecordRef } from "../ports";
import { withRule } from "./record-checks";

// A record the change touched, and the source file that holds it.
export interface TouchedRecord extends RecordRef {
  readonly source: string;
}

// Pages that cite a record the change edits (SN-MNT-014), pages whose evidence no longer
// matches the mirror (SN-MNT-015), and guides without an animation (SN-MNT-016). Findings name
// the page: that is the file to update.
export async function documentationFindings(
  docs: DocumentedRecords,
  touched: readonly TouchedRecord[],
  signal: AbortSignal,
): Promise<Finding[]> {
  const citations = touched.length === 0 ? [] : await docs.citing(touched, signal);
  const edited = citations.flatMap((citation) => {
    const sources = touched
      .filter((record) => record.table === citation.table && record.sysId === citation.sysId)
      .map((record) => record.source);
    return withRule("SN-MNT-014", {
      path: citation.page,
      root: "workspace",
      field: null,
      line: null,
      message: `cites ${citation.table}/${citation.sysId} (${citation.evidence.join(", ")}), which ${sources.join(", ")} changes`,
      evidence: "",
    });
  });
  const stale = (await docs.stale(signal)).flatMap((item) =>
    withRule("SN-MNT-015", {
      path: item.page,
      root: "workspace",
      field: null,
      line: null,
      message: `${item.evidence} ${item.anchor} is ${item.status === "missing" ? "gone from" : "changed in"} the mirror`,
      evidence: "",
    }),
  );
  const unanimated = (await docs.unanimated(signal)).flatMap((page) =>
    withRule("SN-MNT-016", {
      path: page,
      root: "workspace",
      field: null,
      line: null,
      message: "this guide has no animation",
      evidence: "",
    }),
  );
  return [...edited, ...stale, ...unanimated];
}
