import type { Row } from "../kernel/row";

// The operational inventory as the last pull mirrored it, read without calling the instance.
export interface InventoryReader {
  // Rows of instances/<name>/operational/<file>.yaml on the instance's remote branch; null when
  // the inventory was never pulled.
  read(root: string, instance: string, file: string): Promise<readonly Row[] | null>;
}
