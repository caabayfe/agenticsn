import {
  identityFolder,
  parseRecord,
  recordAddress,
  relocatedRecords,
} from "../../metadata/domain/record-layout";
import type { ParsedRecord } from "../domain/change";
import type { DeliveryWorkspace } from "../ports";

type Workspace = Pick<DeliveryWorkspace, "read" | "recordsIn">;

export async function parsed(
  workspace: Workspace,
  base: string,
  at: string | null,
): Promise<ParsedRecord | null> {
  const stored = await workspace.read(base, at);
  return stored === null ? null : parseRecord(stored.document, stored.files);
}

// Where the mirror holds a record: at the same path, or under the name the platform gave it when
// a record created here was pushed and pulled back (same folder and sys_id). Null when it has none.
export async function pulledBase(
  workspace: Workspace,
  base: string,
  commit: string,
): Promise<string | null> {
  if ((await workspace.read(base, commit)) !== null) {
    return base;
  }
  const address = recordAddress(base);
  if (address === null) {
    return null;
  }
  const folder = identityFolder(address.folder);
  const [moved] = relocatedRecords([base], await workspace.recordsIn(folder, commit));
  return moved?.mirror ?? null;
}

// The record as last pulled.
export async function pulledCopy(
  workspace: Workspace,
  base: string,
  commit: string,
): Promise<ParsedRecord | null> {
  const at = await pulledBase(workspace, base, commit);
  return at === null ? null : parsed(workspace, at, commit);
}
