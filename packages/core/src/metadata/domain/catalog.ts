import { ScopeName } from "../../kernel/scope-name";

export interface CatalogData {
  // Table name -> parent table name (null for a root).
  readonly parents: Readonly<Record<string, string | null>>;
  // Scope sys_id -> scope namespace (e.g. x_acme_app).
  readonly scopes: Readonly<Record<string, string>>;
  // Table name -> field name -> dictionary internal type, for fields declared on that table.
  readonly typedFields: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

// The instance's class hierarchy, scopes and field types, read once per sync.
export class Catalog {
  constructor(private readonly data: CatalogData) {}

  // The table first, then each parent up to the root. Stops on a cycle.
  ancestors(table: string): string[] {
    const chain: string[] = [];
    let current: string | null | undefined = table;
    while (current !== null && current !== undefined && !chain.includes(current)) {
      chain.push(current);
      current = this.data.parents[current];
    }
    return chain;
  }

  isMetadata(table: string): boolean {
    return this.ancestors(table).includes("sys_metadata");
  }

  metadataClasses(): string[] {
    return Object.keys(this.data.parents)
      .filter((table) => this.isMetadata(table))
      .sort();
  }

  scopeNamespace(scopeSysId: string | null | undefined): ScopeName {
    if (scopeSysId === null || scopeSysId === undefined || scopeSysId === "") {
      return ScopeName.fromInstance("global");
    }
    return ScopeName.fromInstance(this.data.scopes[scopeSysId] ?? scopeSysId);
  }

  // The sys_id of a scope known by its namespace ("global" for global), or null when unknown.
  scopeSysId(namespace: string): string | null {
    if (namespace === "global") {
      return "global";
    }
    const found = Object.entries(this.data.scopes).find(
      ([sysId, name]) => ScopeName.fromInstance(name) === namespace && sysId !== "",
    );
    return found?.[0] ?? null;
  }

  knowsScope(scopeSysId: string): boolean {
    return scopeSysId === "" || scopeSysId === "global" || scopeSysId in this.data.scopes;
  }

  // Fields declared on this table only (not inherited), with their internal types.
  declaredFields(table: string): Readonly<Record<string, string>> {
    return this.data.typedFields[table] ?? {};
  }
}
