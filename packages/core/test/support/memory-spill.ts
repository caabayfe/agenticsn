import type { KeyedSpill, SpillStore } from "@snagentic/core";

export interface MemorySpills extends SpillStore {
  // Spills opened and not yet closed.
  readonly openSpills: () => number;
}

// Spills held in memory. Values pass through JSON, as on disk, and keys come back in reverse,
// so a caller relying on key order or on sharing objects with the spill fails here too.
export function memorySpills(): MemorySpills {
  let open = 0;
  return {
    openSpills: () => open,
    open: async <T>(): Promise<KeyedSpill<T>> => {
      open += 1;
      const groups = new Map<string, string[]>();
      let closed = false;
      return {
        add: async (key, value) => {
          const list = groups.get(key);
          if (list === undefined) groups.set(key, [JSON.stringify(value)]);
          else list.push(JSON.stringify(value));
        },
        groups: async function* () {
          for (const [key, values] of [...groups].reverse()) {
            const parsed: T[] = values.map((value) => JSON.parse(value));
            yield [key, parsed] as const;
          }
        },
        close: async () => {
          if (!closed) open -= 1;
          closed = true;
          groups.clear();
        },
      };
    },
  };
}
