import { TableName } from "../../kernel/table-name";
import { olderThan } from "../../kernel/version-order";
import type { KeysetPager } from "../../sync/application/keyset-pager";
import {
  StoreAppInstallFailedError,
  StoreAppInstallStateUnknownError,
  StoreAppNotOfferedError,
  StoreAppOutdatedError,
} from "../domain/errors";
import type { ActivationProgress, StoreAppInstaller } from "../ports";
import {
  type ActivationLimits,
  DEFAULT_LIMITS,
  type FollowDependencies,
  follow,
  startOnce,
  type UnknownOutcome,
} from "./follow-progress";

export interface StoreInstallDependencies extends FollowDependencies {
  readonly pager: KeysetPager;
  readonly installer: StoreAppInstaller;
}

// A store application the instance's store offers.
export interface StoreOffer {
  readonly scope: string;
  // The store's latest version.
  readonly version: string;
  // The store refuses to install it on this instance.
  readonly blocked: boolean;
}

export type StoreInstallOutcome =
  | { readonly state: "already-installed"; readonly name: string; readonly version: string }
  | {
      readonly state: "installed";
      readonly name: string;
      readonly version: string;
      readonly progressId: string;
      readonly seconds: number;
    };

const offersListing = (scopes: readonly string[], fields: readonly string[]) => ({
  table: TableName.parse("sys_remote_app"),
  fields: ["sys_id", ...fields],
  kind: "snapshot" as const,
  base: `scopeIN${scopes.join(",")}`,
});

async function readOffers(pager: KeysetPager, scopes: readonly string[], signal: AbortSignal) {
  const found = new Map<string, StoreOffer & { readonly name: string }>();
  if (scopes.length === 0) return found;
  const listing = offersListing(scopes, ["scope", "name", "latest_version", "block_install"]);
  for await (const row of pager.rows(listing, signal)) {
    const scope = row["scope"] ?? "";
    found.set(scope, {
      scope,
      name: row["name"] ?? scope,
      version: row["latest_version"] ?? "",
      blocked: row["block_install"] === "true",
    });
  }
  return found;
}

// What the store offers for these scopes, read live: only the rows asked for, never the whole
// store (thousands of rows), in the order asked.
export async function storeOffers(
  pager: KeysetPager,
  scopes: readonly string[],
  signal: AbortSignal,
): Promise<StoreOffer[]> {
  const found = await readOffers(pager, scopes, signal);
  return scopes.flatMap((s) => {
    const offer = found.get(s);
    return offer === undefined
      ? []
      : [{ scope: offer.scope, version: offer.version, blocked: offer.blocked }];
  });
}

// The application as the instance holds it now (not the possibly stale inventory).
async function installed(pager: KeysetPager, scope: string, signal: AbortSignal) {
  const listing = {
    table: TableName.parse("sys_scope"),
    fields: ["sys_id", "scope", "name", "version"],
    kind: "snapshot" as const,
    base: `scope=${scope}`,
  };
  for await (const row of pager.rows(listing, signal)) {
    if (row["scope"] === scope)
      return { name: row["name"] ?? scope, version: row["version"] ?? "" };
  }
  return null;
}

// What to install: the version named (null: the store's latest), and whether with the
// application's own demo data (ADR-0048).
export interface StoreInstallRequest {
  readonly version: string | null;
  readonly demoData: boolean;
}

// Installs a store application through the CI/CD API and follows it to the end (spec 011, I3).
// Never an upgrade, never retried; demo data only when the request asks for it.
export async function installStoreApp(
  deps: StoreInstallDependencies,
  instance: string,
  scope: string,
  request: StoreInstallRequest,
  signal: AbortSignal,
  report: (progress: ActivationProgress) => void = () => {},
  limits: ActivationLimits = DEFAULT_LIMITS,
): Promise<StoreInstallOutcome> {
  const offer = (await readOffers(deps.pager, [scope], signal)).get(scope);
  const present = await installed(deps.pager, scope, signal);
  const wanted = request.version ?? offer?.version ?? "";
  if (present !== null) {
    if (wanted !== "" && olderThan(present.version, wanted)) {
      throw new StoreAppOutdatedError(scope, present.version, wanted);
    }
    return { state: "already-installed", name: present.name, version: present.version };
  }
  if (offer === undefined || offer.blocked) throw new StoreAppNotOfferedError(instance, scope);
  const name = offer.name;
  const started = deps.now().getTime();
  const unknown: UnknownOutcome = (reason, progressId) =>
    new StoreAppInstallStateUnknownError(scope, reason, progressId);
  const first = await startOnce(
    () => deps.installer.install(scope, wanted, request.demoData, signal),
    unknown,
  );
  const final = await follow(deps, first, (id) => deps.installer.progress(id, signal), {
    limits,
    signal,
    report,
    unknown,
  });
  if (final.status !== "successful") {
    throw new StoreAppInstallFailedError(
      scope,
      final.progressId,
      final.error || final.message || final.status,
    );
  }
  const seconds = Math.round((deps.now().getTime() - started) / 1000);
  return { state: "installed", name, version: wanted, progressId: final.progressId, seconds };
}
