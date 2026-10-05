// Parses the Server-Timing header into durations in milliseconds, e.g.
// `t;desc="…", sem_wait;dur=12, sesh_wait;dur=0` -> { sem_wait: 12, sesh_wait: 0 }.
export function parseServerTiming(header: string | null): Readonly<Record<string, number>> {
  if (header === null) {
    return {};
  }
  const durations: Record<string, number> = {};
  for (const entry of header.split(",")) {
    const [name, ...parameters] = entry.split(";").map((part) => part.trim());
    const duration = parameters.find((parameter) => parameter.startsWith("dur="));
    const value = Number(duration?.slice(4));
    if (name !== undefined && name !== "" && duration !== undefined && !Number.isNaN(value)) {
      durations[name] = value;
    }
  }
  return durations;
}
