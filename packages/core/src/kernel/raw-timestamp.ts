// ServiceNow's raw timestamps: "YYYY-MM-DD HH:MM:SS", in UTC.
export function parseRawTimestamp(timestamp: string): number {
  const time = Date.parse(`${timestamp.replace(" ", "T")}Z`);
  if (Number.isNaN(time)) {
    throw new Error(`not a raw UTC timestamp: ${timestamp}`);
  }
  return time;
}

export function formatRawTimestamp(time: number): string {
  return new Date(time).toISOString().slice(0, 19).replace("T", " ");
}
