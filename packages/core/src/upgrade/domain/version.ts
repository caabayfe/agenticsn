// Release versions are x.y.z, tagged vx.y.z (scripts/check-release.ts).
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text: string): string | null {
  const match = VERSION.exec(text.trim());
  return match === null ? null : `${match[1]}.${match[2]}.${match[3]}`;
}

// Negative when a is older than b, positive when newer, 0 when equal.
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
