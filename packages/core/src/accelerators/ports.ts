// Where accelerator packs come from: the first-party packs embedded in snagentic (ADR-0026).
export interface PackSource {
  // Pack ids, sorted.
  ids(): Promise<readonly string[]>;
  // A pack's accelerator.yaml, parsed; null when there is no such pack.
  manifest(id: string): Promise<unknown | null>;
}
