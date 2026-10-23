import { SnagenticError } from "../../kernel/errors";

export class PaginationStalledError extends SnagenticError {
  constructor(table: string) {
    super(
      "pagination-stalled",
      "remote",
      `listing ${table} stopped advancing: the instance returned the same page again`,
      "nothing was skipped silently; please report this table and instance version",
    );
  }
}

export class NothingPulledError extends SnagenticError {
  constructor(instance: string) {
    super(
      "nothing-pulled",
      "precondition",
      `${instance} has not been pulled yet`,
      `run: snagentic pull ${instance}`,
    );
  }
}

// Every instance has password fields (basic auth profiles, for one): a dictionary listing with
// none was shortened by ACLs, and redacting by field name alone would let secrets through
// (spec 012, B-06).
export class DictionaryUnreadableError extends SnagenticError {
  constructor() {
    super(
      "dictionary-unreadable",
      "not-permitted",
      "the instance's dictionary shows this user no password fields, so snagentic can't tell which values to redact",
      "nothing was written; give the user read access to every sys_dictionary row, or pull with an account that has it",
    );
  }
}
