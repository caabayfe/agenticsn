// Spike S13, test A3 (Windows): with S13_TRACE=1, record every path the build passes to the
// fileSystem and whether the call failed, and print a summary to compare platforms.
type Call = { method: string; path: string; failed: boolean };

export function traced<T extends object>(fileSystem: T): { fs: T; report(): void } {
  const calls: Call[] = [];
  const fs = new Proxy(fileSystem, {
    get(target, prop: string) {
      const value = (target as Record<string, unknown>)[prop];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const path = typeof args[0] === "string" ? args[0] : "";
        try {
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (error) {
          calls.push({ method: prop, path, failed: true });
          throw error;
        } finally {
          if (path && !calls.some((c) => c.path === path && c.method === prop)) {
            calls.push({ method: prop, path, failed: false });
          }
        }
      };
    },
  });
  const report = () => {
    const builtIns = calls.filter((c) => /built-ins/.test(c.path));
    const failedModules = calls.filter((c) => c.failed && /node_modules/.test(c.path));
    console.log(
      `trace: ${calls.length} calls; built-ins ${builtIns.length}; failed under node_modules ${failedModules.length}`,
    );
    const read = builtIns.filter((c) => c.method === "readFileSync" && !c.failed);
    console.log(`trace built-ins read: ${read.length}`);
    for (const c of read.slice(0, 3)) console.log(`trace built-in read ${JSON.stringify(c.path)}`);
    for (const c of failedModules.filter((c) => /built-ins/.test(c.path)).slice(0, 8))
      console.log(`trace failed ${c.method} ${JSON.stringify(c.path)}`);
    const keys = calls.filter((c) => /keys\.ts/.test(c.path));
    for (const c of keys.slice(0, 5))
      console.log(`trace keys ${c.method} ${c.failed ? "FAILED " : ""}${JSON.stringify(c.path)}`);
  };
  return { fs, report };
}
