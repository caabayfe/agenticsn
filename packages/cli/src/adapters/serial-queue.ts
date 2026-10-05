export interface SerialQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

// Runs async operations one after another, in call order, even when callers run
// concurrently. Shared resources (one fast-import stream, one state file) need this.
export function serialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
