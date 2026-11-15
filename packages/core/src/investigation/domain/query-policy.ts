import { InvalidInputError } from "../../kernel/errors";
import { sha256Hex } from "../../kernel/sha256";

export interface LiveField {
  readonly name: string;
  readonly type: string;
  readonly reference: string;
  readonly unique: boolean;
  readonly declaredOn: string;
}
export interface LiveSchema {
  readonly table: string;
  readonly ancestors: readonly string[];
  readonly fields: readonly LiveField[];
  readonly complete: boolean;
}
export interface QueryTerm {
  readonly field: string;
  readonly operator: string;
  readonly value: string;
}
export type QueryGroups = readonly (readonly (readonly QueryTerm[])[])[];

export function assertReadableTable(table: string): void {
  if (
    /(?:credential|oauth|certificate|private_key|sys_auth|sys_user_token|sys_user_session|sys_user_preference)/i.test(
      table,
    )
  ) {
    throw new InvalidInputError(
      "live investigation does not expose credential, session or identity preference tables",
    );
  }
}

export function parseLiveQuery(query: string): QueryGroups {
  if (
    query.length > 4096 ||
    /javascript\s*:|DYNAMIC|RELATIVE|[\r\n]/i.test(query) ||
    query.includes(String.fromCharCode(0))
  ) {
    throw new InvalidInputError(
      "queries must contain literal values, not scripts, dynamic filters or control characters",
    );
  }
  if (query.split("^").length > 32) throw new InvalidInputError("queries support at most 32 terms");
  return query.split("^NQ").map(parseGroup);
}

function parseTerm(text: string): QueryTerm {
  const match =
    /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,2})(ISNOTEMPTY|ISEMPTY|NOT IN|IN|STARTSWITH|!=|>=|<=|=|>|<)([^^]*)$/.exec(
      text,
    );
  if (match === null)
    throw new InvalidInputError(
      "unsupported or empty encoded query; use literal comparisons, ^, ^OR and ^NQ",
    );
  const term = { field: match[1] ?? "", operator: match[2] ?? "", value: match[3] ?? "" };
  if (term.value.length === 0 && !["ISEMPTY", "ISNOTEMPTY"].includes(term.operator))
    throw new InvalidInputError("query comparisons require a value");
  if (["ISEMPTY", "ISNOTEMPTY"].includes(term.operator) && term.value !== "")
    throw new InvalidInputError("empty operators do not accept a value");
  return term;
}

function parseGroup(group: string): QueryTerm[][] {
  const clauses: QueryTerm[][] = [];
  for (const token of group.split("^")) {
    if (!token.startsWith("OR")) clauses.push([parseTerm(token)]);
    else {
      const previous = clauses.at(-1);
      if (previous === undefined) throw new InvalidInputError("OR needs a preceding condition");
      previous.push(parseTerm(token.slice(2)));
    }
  }
  return clauses;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function utcTimestamp(value: string | undefined): number {
  if (value === undefined || !TIMESTAMP.test(value)) return NaN;
  const iso = `${value.replace(" ", "T")}Z`;
  const stamp = Date.parse(iso);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === iso.replace("Z", ".000Z")
    ? stamp
    : NaN;
}

export function assertSelectiveQuery(groups: QueryGroups, fields: readonly LiveField[]): void {
  const unique = new Set(fields.filter((field) => field.unique).map((field) => field.name));
  unique.add("sys_id");
  for (const group of groups) {
    const keyed = group.some((clause) =>
      clause.every(
        (term) =>
          unique.has(term.field) &&
          (term.operator === "=" || term.operator === "IN") &&
          term.value.split(",").length <= 100 &&
          term.value
            .split(",")
            .every((value) => value.trim() !== "" && !/^(?:NULL|EMPTYSTRING)$/i.test(value)),
      ),
    );
    const singles = group.filter((clause) => clause.length === 1).flat();
    const lower = singles.find(
      (term) => term.field === "sys_updated_on" && [">", ">="].includes(term.operator),
    );
    const upper = singles.find(
      (term) => term.field === "sys_updated_on" && ["<", "<="].includes(term.operator),
    );
    const since = utcTimestamp(lower?.value);
    const until = utcTimestamp(upper?.value);
    if (!keyed && !(until > since && until - since <= 31 * 86400000)) {
      throw new InvalidInputError(
        "every NQ branch needs an equality/IN on sys_id or a unique field, or explicit UTC sys_updated_on bounds no more than 31 days apart",
      );
    }
  }
}

export function queryBinding(
  table: string,
  query: string,
  fields: readonly string[],
  limit: number,
  source = "",
): string {
  return sha256Hex(JSON.stringify([source, table, query, fields, limit]));
}

export function cursorAfter(cursor: string | undefined, binding: string): string | null {
  if (cursor === undefined) return null;
  const match = /^([a-f0-9]{64}):([a-f0-9]{32})$/.exec(cursor);
  if (match?.[1] !== binding)
    throw new InvalidInputError(
      "cursor does not match this instance, identity, table, query, fields and limit; restart the query",
    );
  return match[2] ?? null;
}
