import type { DataEntity } from "./manifest-types";

// The domain a load puts its rows into (spec 011, section 15, items 5 to 8). An instance separates
// data by domain when its mirrored inventory lists domains; then every row goes into the domain
// --domain names, and the columns only domain separation uses are mandatory. Pure.

export type DataDomain =
  | { readonly separated: false }
  | { readonly separated: true; readonly name: string; readonly sysId: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

// `domains`: the mirror's operational/domains.yaml rows, or null when the mirror has none.
export function resolveDataDomain(
  domains: readonly Readonly<Record<string, unknown>>[] | null,
  requested: string | undefined,
  instance: string,
): { readonly domain: DataDomain; readonly problems: readonly string[] } {
  const none: DataDomain = { separated: false };
  if (domains === null) {
    return {
      domain: none,
      problems: [
        `pull ${instance} first: the mirror does not say whether it separates data by domain`,
      ],
    };
  }
  if (domains.length === 0) {
    return requested === undefined
      ? { domain: none, problems: [] }
      : {
          domain: none,
          problems: [
            `--domain ${requested}: ${instance} does not separate data by domain; leave --domain out`,
          ],
        };
  }
  const active = domains.filter((d) => text(d["active"]) !== "false");
  const names = active.map((d) => text(d["name"])).sort();
  const choices = `(one of: ${names.join(", ")})`;
  if (requested === undefined) {
    return {
      domain: none,
      problems: [
        `${instance} separates data by domain: name the domain the data goes into with --domain ${choices}`,
      ],
    };
  }
  const found = active.find((d) => text(d["name"]) === requested);
  return found === undefined
    ? {
        domain: none,
        problems: [
          `--domain ${requested}: no active domain of that name on ${instance} ${choices}`,
        ],
      }
    : { domain: { separated: true, name: requested, sysId: text(found["sys_id"]) }, problems: [] };
}

// An entity as a load on this instance sees it: its domain columns are mandatory where the
// instance separates data by domain, and gone elsewhere.
export function domainEntity<E extends DataEntity>(entity: E, domain: DataDomain): E {
  return {
    ...entity,
    columns: domain.separated
      ? entity.columns.map((c) => (c.domain ? { ...c, required: true } : c))
      : entity.columns.filter((c) => !c.domain),
  };
}

// The template columns a load sends, and the values it adds: the domain's sys_id in every row
// where the instance separates data by domain. Always u_sys_domain, whatever the staging table:
// sys_domain would be the import set row's own domain, not the target record's.
export function domainRow(
  entity: DataEntity,
  domain: DataDomain,
  columns: readonly string[],
  row: readonly string[],
): { readonly columns: readonly string[]; readonly row: readonly string[] } {
  if (domain.separated) {
    return { columns: [...columns, "u_sys_domain"], row: [...row, domain.sysId] };
  }
  const dropped = new Set(entity.columns.filter((c) => c.domain).map((c) => c.name));
  const kept = columns.flatMap((c, i) => (dropped.has(c) ? [] : [i]));
  return { columns: kept.map((i) => columns[i] ?? ""), row: kept.map((i) => row[i] ?? "") };
}
