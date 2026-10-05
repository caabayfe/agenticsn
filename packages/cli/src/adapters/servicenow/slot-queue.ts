import { OperationCancelledError } from "@snagentic/core";

// Admits work while fewer than limit() items are running; others wait in arrival order.
export class SlotQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: () => number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new OperationCancelledError();
    }
    if (this.running < this.limit()) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const admit = () => {
        signal.removeEventListener("abort", cancel);
        this.running += 1;
        resolve();
      };
      const cancel = () => {
        this.waiting.splice(this.waiting.indexOf(admit), 1);
        reject(new OperationCancelledError());
      };
      this.waiting.push(admit);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  release(): void {
    this.running -= 1;
    while (this.running < this.limit() && this.waiting.length > 0) {
      this.waiting.shift()?.();
    }
  }
}
