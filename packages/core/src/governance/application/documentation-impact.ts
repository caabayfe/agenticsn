import type { DocumentedClaim } from "../ports";
import { checkSince, type ValidateDependencies } from "./validate";

// What a change does to the documentation (ADR-0039): each page whose evidence it affects, with
// the claims that evidence supports, from source the change edits since `base` and from changes
// on the instance a pull brought into the mirror.

export interface DocumentationImpactQuery {
  readonly base: string;
  readonly signal?: AbortSignal;
}

export type ImpactCause =
  | { readonly kind: "source"; readonly files: readonly string[] }
  | { readonly kind: "instance"; readonly status: "changed" | "missing" };

export interface ImpactItem {
  readonly page: string;
  readonly title: string;
  // <table>/<sys_id>
  readonly record: string;
  readonly evidence: readonly string[];
  readonly cause: ImpactCause;
  readonly claims: readonly DocumentedClaim[];
}

export interface DocumentationImpact {
  readonly base: string;
  // Units the change adds or edits.
  readonly units: number;
  readonly items: readonly ImpactItem[];
}

export async function documentationImpact(
  deps: ValidateDependencies,
  query: DocumentationImpactQuery,
): Promise<DocumentationImpact> {
  const signal = query.signal ?? new AbortController().signal;
  const { checked } = await checkSince(deps, { base: query.base, signal });
  const units = checked.reduce((sum, check) => sum + check.units, 0);
  const docs = deps.documentation;
  if (docs === undefined) return { base: query.base, units, items: [] };
  const touched = checked.flatMap((check) => check.touched);
  const cited = touched.length === 0 ? [] : await docs.citing(touched, signal);
  const fromSource = cited.map(
    (citation): ImpactItem => ({
      page: citation.page,
      title: citation.title,
      record: `${citation.table}/${citation.sysId}`,
      evidence: citation.evidence,
      cause: {
        kind: "source",
        files: touched
          .filter((record) => record.table === citation.table && record.sysId === citation.sysId)
          .map((record) => record.source),
      },
      claims: citation.claims,
    }),
  );
  const fromInstance = (await docs.stale(signal)).map(
    (item): ImpactItem => ({
      page: item.page,
      title: item.title,
      record: item.anchor,
      evidence: [item.evidence],
      cause: { kind: "instance", status: item.status },
      claims: item.claims,
    }),
  );
  return { base: query.base, units, items: [...fromSource, ...fromInstance] };
}
