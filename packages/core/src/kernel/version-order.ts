// Platform component versions (plugins, store applications), compared by numeric segment.

const parts = (version: string) => version.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);

// a < b, comparing numeric segments (1.10.0 is newer than 1.9.4).
export function olderThan(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p !== q) return p < q;
  }
  return false;
}
