// An accelerator pack's manifest (ADR-0026, format 2 by ADR-0038): accelerator.yaml for the pack,
// and one modules/<module>/module.yaml per module. A module is called a capability in the code.

// A plugin or a store application a module needs, installed by the platform's installer.
export interface Component {
  readonly kind: "plugin" | "app";
  // A plugin id, or an application's scope.
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
  // Rows the pack owns carry a fixed sys_id in a sys_id column (ADR-0038, item 7): anchors.
  readonly anchors: boolean;
}

export interface Capability {
  readonly id: string;
  // Names the module's update sets.
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly components: readonly Component[];
  readonly data: readonly DataEntity[];
}

export interface Manifest {
  readonly id: string;
  readonly version: string;
  readonly requires: { readonly snagentic: string };
  // Platform releases the pack was tested on (lowercase family names); empty: none recorded.
  readonly tested: readonly string[];
  // Named sets of modules, by profile id.
  readonly profiles: Readonly<Record<string, readonly string[]>>;
  // By id.
  readonly capabilities: readonly Capability[];
}
