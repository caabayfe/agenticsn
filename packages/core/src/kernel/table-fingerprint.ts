// Count and latest sys_updated_on of a table: inserts and updates raise the latest update,
// deletions lower the count (ADR-0016, M4 appendix). It lives in the kernel because the
// connection port returns it and sync compares it; neither context owns the other.
export interface TableFingerprint {
  readonly count: number;
  readonly maxUpdatedOn: string | null;
}
