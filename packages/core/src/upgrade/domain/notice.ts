// The update notice (ADR-0023): one line for a person at a terminal, at most one check a day.
const DAY_MS = 24 * 60 * 60 * 1000;
// Agents' entry points, the upgrade itself, and help or version output.
const QUIET_COMMANDS = new Set(["mcp", "hook", "upgrade", "help"]);

export interface NoticeSurface {
  readonly command: string | undefined;
  readonly format: string;
  // Standard error is a terminal.
  readonly interactive: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function noticeAllowed(surface: NoticeSurface): boolean {
  const { command, format, interactive, env } = surface;
  return (
    command !== undefined &&
    !command.startsWith("-") &&
    !QUIET_COMMANDS.has(command) &&
    format === "text" &&
    interactive &&
    (env["CI"] ?? "") === "" &&
    (env["SNAGENTIC_NO_UPDATE_CHECK"] ?? "") === ""
  );
}

// Whether the last check (an ISO time, or null) is over a day old.
export function checkDue(lastCheck: string | null, now: Date): boolean {
  const last = lastCheck === null ? Number.NaN : Date.parse(lastCheck);
  return Number.isNaN(last) || now.getTime() - last >= DAY_MS;
}

export function noticeText(latest: string): string {
  return `snagentic ${latest} is available: run snagentic upgrade`;
}
