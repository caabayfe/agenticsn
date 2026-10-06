import { OperationCancelledError } from "../../kernel/errors";
import type { ServerCost, ServerCostReader } from "../ports";

// The cost report is information, not part of the work: when the transaction log cannot be
// read (read-only users usually may not), the report is simply unavailable. Cancellation still
// cancels.
export async function measureServerCost(
  reader: ServerCostReader,
  since: string,
  signal: AbortSignal,
): Promise<ServerCost | null> {
  try {
    return await reader.serverCost(since, signal);
  } catch (error) {
    if (error instanceof OperationCancelledError || signal.aborted) {
      throw error;
    }
    return null;
  }
}
