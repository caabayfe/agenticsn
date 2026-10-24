import type { DataEntity } from "./manifest-types";

// Why the instance did not take a data row, from the Import Set API's message for it. Business
// field values never leave the instance (ASR-08): the platform's message names the rejected
// value, so a reason names the column and the target field instead.

export interface RowFailure {
  // The row's business key, as the load reports it.
  readonly key: string;
  readonly status: "skipped" | "error";
  readonly message: string;
}

export interface RowProblem {
  readonly reason: string;
  readonly action: string;
  // The business keys of the rows that failed for it.
  readonly rows: readonly string[];
}

const REJECTED = /Reference field value for ([a-z0-9_]+)\.([a-z0-9_]+) rejected/;

function explain(entity: DataEntity, failure: RowFailure): { reason: string; action: string } {
  const match = REJECTED.exec(failure.message);
  const column = entity.columns.find((c) => match !== null && c.field === match[2]);
  if (match === null || column === undefined) {
    return {
      reason: `the transform ${failure.status === "error" ? "failed" : "skipped"} it`,
      action: `the comment on its row in ${entity.table} gives the platform's reason`,
    };
  }
  const reason = `column ${column.name} names a record ${match[1]}.${match[2]} does not find`;
  if (column.references !== null) {
    return {
      reason,
      action: `load the ${column.references} rows it names first, or correct ${column.name}`,
    };
  }
  return {
    reason,
    action: `change ${column.name} to name a record the instance has, or leave it empty where it is optional`,
  };
}

// The failed rows by reason, in the order they failed.
export function rowProblems(entity: DataEntity, failures: readonly RowFailure[]): RowProblem[] {
  const problems = new Map<string, { reason: string; action: string; rows: string[] }>();
  for (const failure of failures) {
    const { reason, action } = explain(entity, failure);
    const problem = problems.get(reason) ?? { reason, action, rows: [] };
    problem.rows.push(failure.key);
    problems.set(reason, problem);
  }
  return [...problems.values()];
}
