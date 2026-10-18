import { type Claim, claimsOf } from "../domain/claims";
import { NoDocumentationError } from "../domain/errors";
import type { RecordEvidence } from "../domain/evidence";
import type { DocPage } from "../domain/page";
import { structureProblems } from "../domain/structure";
import { assessDocumentation, type CheckDocsDependencies, todayOf } from "./check-docs";
import { type Documentation, loadDocumentation } from "./load-documentation";

// The documentation as other contexts ask about it (validate, ADR-0036 P4 and ADR-0039): which
// pages cite a record a change edits, and which evidence no longer matches the mirror, with the
// claims each supports. Pages are workspace-relative.
interface CitedRecord {
  readonly table: string;
  readonly sysId: string;
  // The fields the change edits; absent when it adds or deletes the record.
  readonly changed?: readonly string[];
}

export interface DocumentationLookup {
  citing(
    records: readonly CitedRecord[],
    signal: AbortSignal,
  ): Promise<
    readonly {
      table: string;
      sysId: string;
      page: string;
      title: string;
      evidence: readonly string[];
      claims: readonly Claim[];
    }[]
  >;
  stale(signal: AbortSignal): Promise<
    readonly {
      page: string;
      title: string;
      evidence: string;
      anchor: string;
      status: "changed" | "missing";
      claims: readonly Claim[];
    }[]
  >;
  unanimated(signal: AbortSignal): Promise<readonly string[]>;
}

// Evidence on one field is affected only when the change edits that field; evidence on a
// record's children, only when the record is added or deleted.
function affected(item: RecordEvidence, record: CitedRecord): boolean {
  if (record.changed === undefined) return true;
  if (item.children !== undefined) return false;
  return item.field === undefined || record.changed.includes(item.field);
}

function citationsOn(page: DocPage, records: ReadonlyMap<string, CitedRecord>) {
  const byRecord = new Map<string, string[]>();
  for (const item of page.evidence) {
    if (item.kind !== "record") continue;
    const key = `${item.table}/${item.sysId}`;
    const record = records.get(key);
    if (record === undefined || !affected(item, record)) continue;
    byRecord.set(key, [...(byRecord.get(key) ?? []), item.id]);
  }
  return [...byRecord].map(([key, evidence]) => {
    const [table = "", sysId = ""] = key.split("/");
    const claims = claimsOf(page, evidence);
    return { table, sysId, page: `${FOLDER}/${page.path}`, title: page.title, evidence, claims };
  });
}

const FOLDER = "documentation";

export function documentationLookup(
  deps: Omit<CheckDocsDependencies, "signal">,
): DocumentationLookup {
  const load = async (): Promise<Documentation | null> => {
    try {
      return await loadDocumentation(deps.sources, deps.root);
    } catch (error) {
      if (error instanceof NoDocumentationError) return null;
      throw error;
    }
  };
  return {
    async citing(records) {
      const docs = await load();
      if (docs === null) return [];
      const wanted = new Map(records.map((record) => [`${record.table}/${record.sysId}`, record]));
      return docs.pages.flatMap((page) => citationsOn(page, wanted));
    },
    async stale(signal) {
      const docs = await load();
      if (docs === null) return [];
      const check = await assessDocumentation(
        docs,
        deps.mirror(docs.config.instance),
        todayOf(deps.clock),
        signal,
      );
      const pageAt = new Map(docs.pages.map((page) => [page.path, page]));
      return check.evidence.flatMap((item) => {
        const page = pageAt.get(item.page);
        return page !== undefined && (item.status === "changed" || item.status === "missing")
          ? [
              {
                page: `${FOLDER}/${item.page}`,
                title: page.title,
                evidence: item.id,
                anchor: item.anchor,
                status: item.status,
                claims: claimsOf(page, [item.id]),
              },
            ]
          : [];
      });
    },
    async unanimated() {
      const docs = await load();
      if (docs === null) return [];
      return structureProblems(docs)
        .filter((problem) => problem.kind === "missing-animation")
        .map((problem) => `${FOLDER}/${problem.page}`);
    },
  };
}
