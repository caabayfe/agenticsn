// Durable evidence about an attempted delivery: identifiers and hashes, never payloads.
export interface PendingDelivery {
  readonly project: string;
  readonly updateName: string;
  readonly digest: string;
  readonly updateSet: string;
  readonly before: string | null;
  readonly operation: "create" | "load" | "delete";
  readonly removes: string | null;
  readonly verified?: boolean;
  readonly captureName?: string;
  // Absent until read-back completed; null means the record was absent after the load.
  readonly observed?: string | null;
}
