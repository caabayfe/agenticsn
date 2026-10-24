import type { InventoryReader } from "../../plugins/index";
import type { Selection } from "../domain/capability-graph";
import type {
  DataTemplates,
  OpenUpdateSets,
  PackSource,
  PackWorkspace,
  SchemaReader,
} from "../ports";
import type { DataSource } from "./validate-data";

// What an install plan is asked for, and what it reads (ADR-0038, item 2.1).
export interface InstallQuery extends Selection {
  readonly pack: string;
  readonly instance: { readonly root: string; readonly name: string; readonly kind: string };
  readonly source: DataSource;
  readonly snagentic: string;
  readonly signal: AbortSignal;
  // --domain: the domain the data goes into, on an instance that separates data by domain.
  readonly domain?: string;
}

export interface InstallPlanDependencies {
  readonly packs: PackSource;
  readonly inventory: InventoryReader;
  readonly workspace: PackWorkspace;
  readonly templates: DataTemplates;
  // The mirror's tables, for the platform fields the modules read (plan gap G13).
  readonly schema: SchemaReader;
  // The instance's update sets in progress, read live: the pack's earlier ones are completed.
  readonly updateSets: OpenUpdateSets;
}
