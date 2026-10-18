import type { Finding } from "../domain/findings";
import type { ChangedRecord, DocumentedClaim, DocumentedRecords } from "../ports";
import { withRule } from "./record-checks";

// A record the change touched, and the source file that holds it.
export interface TouchedRecord extends ChangedRecord {
  readonly source: string;
}

// The first claim the evidence supports, quoted, so the finding says what may now be wrong.
function quoted(claims: readonly DocumentedClaim[]): string {
  const [first] = claims;
  if (first === undefined) return "";
  const more = claims.length - 1;
  const rest = more === 0 ? "" : ` (and ${more} more claim${more === 1 ? "" : "s"})`;
  return `: "${first.text}"${rest}`;
}

// Pages that cite a record the change edits (SN-MNT-014), pages whose evidence no longer
// matches the mirror (SN-MNT-015), guides without an animation (SN-MNT-016), and pages pinned
// again since base without a release note (SN-MNT-017). Findings name the page: that is the
// file to update.
export async function documentationFindings(
  docs: DocumentedRecords,
  change: { readonly base: string; readonly touched: readonly TouchedRecord[] },
  signal: AbortSignal,
): Promise<Finding[]> {
  const touched = change.touched;
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
      message: `cites ${citation.table}/${citation.sysId} (${citation.evidence.join(", ")}), which ${sources.join(", ")} changes${quoted(citation.claims)}`,
      evidence: "",
    });
  });
  const stale = (await docs.stale(signal)).flatMap((item) =>
    withRule("SN-MNT-015", {
      path: item.page,
      root: "workspace",
      field: null,
      line: null,
      message: `${item.evidence} ${item.anchor} is ${item.status === "missing" ? "gone from" : "changed in"} the mirror${quoted(item.claims)}`,
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
  const unnoted = ((await docs.unnoted?.(change.base, signal)) ?? []).flatMap((item) =>
    withRule("SN-MNT-017", {
      path: item.page,
      root: "workspace",
      field: null,
      line: null,
      message: `${item.evidence.join(", ")} pinned to a changed record, and no release note links ${item.title}`,
      evidence: "",
    }),
  );
  return [...edited, ...stale, ...unanimated, ...unnoted];
}
