import { NoDocumentationError } from "../domain/errors";
import { structureProblems } from "../domain/structure";
import { assessDocumentation, type CheckDocsDependencies, todayOf } from "./check-docs";
import { type Documentation, loadDocumentation } from "./load-documentation";

// The documentation as other contexts ask about it (validate, ADR-0036 P4): which pages cite a
// record, and which evidence no longer matches the mirror. Pages are workspace-relative.
export interface DocumentationLookup {
  citing(
    records: readonly { readonly table: string; readonly sysId: string }[],
    signal: AbortSignal,
  ): Promise<
    readonly { table: string; sysId: string; page: string; evidence: readonly string[] }[]
  >;
  stale(
    signal: AbortSignal,
  ): Promise<
    readonly { page: string; evidence: string; anchor: string; status: "changed" | "missing" }[]
  >;
  unanimated(signal: AbortSignal): Promise<readonly string[]>;
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
      const wanted = new Set(records.map((record) => `${record.table}/${record.sysId}`));
      return docs.pages.flatMap((page) => {
        const byRecord = new Map<string, string[]>();
        for (const item of page.evidence) {
          if (item.kind !== "record" || !wanted.has(`${item.table}/${item.sysId}`)) continue;
          const key = `${item.table}/${item.sysId}`;
          byRecord.set(key, [...(byRecord.get(key) ?? []), item.id]);
        }
        return [...byRecord].map(([key, evidence]) => {
          const [table = "", sysId = ""] = key.split("/");
          return { table, sysId, page: `${FOLDER}/${page.path}`, evidence };
        });
      });
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
      return check.evidence.flatMap((item) =>
        item.status === "changed" || item.status === "missing"
          ? [
              {
                page: `${FOLDER}/${item.page}`,
                evidence: item.id,
                anchor: item.anchor,
                status: item.status,
              },
            ]
          : [],
      );
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
