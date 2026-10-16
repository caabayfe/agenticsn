// The instance routes the embedded SDK may call through snagentic's connector (ADR-0032 item 3).
// Reads only: Table API GETs and the two read-only exports transform uses (SDK 4.13.6, S17).

const READ_EXPORTS: readonly RegExp[] = [
  /^\/api\/sn_glider\/fluent_support\/table_relationship_exporter$/,
  /^\/api\/sn_glider\/metadata\/unload\/[0-9a-f]{32}$/,
];

const TABLE_READ = /^\/api\/now\/table\/[a-z0-9_]+(\/[0-9a-f]{32})?$/;

export function sdkRouteAllowed(method: string, path: string): boolean {
  if (method === "GET") return TABLE_READ.test(path);
  return method === "POST" && READ_EXPORTS.some((route) => route.test(path));
}
