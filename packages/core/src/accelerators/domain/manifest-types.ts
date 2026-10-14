// An accelerator pack's manifest, accelerator.yaml (ADR-0026).

export interface PluginRequirement {
  readonly id: string;
  // null: any version.
  readonly minVersion: string | null;
  readonly entitlement: "free" | "licensed";
}

// A template column's rules: a mandatory field, and a reference to another entity's key.
export interface DataColumn {
  readonly name: string;
  readonly required: boolean;
  // The entity whose business key this column holds, or null.
  readonly references: string | null;
}

// A kind of record the pack loads per instance through an import set table (spike S-B).
export interface DataEntity {
  readonly entity: string;
  // The template file in a data directory: <entity>.csv unless the manifest names another.
  readonly file: string;
  readonly columns: readonly DataColumn[];
  // The import set table; its transform map coalesces on `key`.
  readonly table: string;
  readonly key: readonly string[];
  // Entities that must be loaded first (their records are referenced).
  readonly after: readonly string[];
}

export interface Capability {
  readonly id: string;
  readonly wave: number;
  // Names the capability's update sets.
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly plugins: readonly PluginRequirement[];
  readonly data: readonly DataEntity[];
}

export interface Manifest {
  readonly id: string;
  readonly version: string;
  readonly requires: { readonly snagentic: string };
  readonly scope: string;
  // By id.
  readonly capabilities: readonly Capability[];
}
