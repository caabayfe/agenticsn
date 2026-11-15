type Server = { readonly command: string; readonly args: readonly string[] };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function withCodexMcp(
  existing: string | null,
  wanted: Readonly<Record<string, Server>>,
  parse: (text: string) => unknown,
): string | null {
  try {
    const config = parse(existing ?? "");
    if (!record(config)) return null;
    const servers = config["mcp_servers"] ?? {};
    if (!record(servers) || "snagentic" in servers) return null;
    if (
      Object.entries(wanted).some(
        ([name, server]) =>
          name in servers && JSON.stringify(servers[name]) !== JSON.stringify(server),
      )
    )
      return null;
    const additions = Object.entries(wanted)
      .filter(([name]) => !(name in servers))
      .map(
        ([name, server]) =>
          `[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`,
      );
    if (additions.length === 0) return existing;
    const merged = `${existing ?? ""}${existing?.endsWith("\n\n") ? "" : "\n"}${additions.join("\n")}`;
    parse(merged);
    return merged;
  } catch {
    return null;
  }
}
