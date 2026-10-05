export interface ResponseSignal {
  readonly status: number;
  // ServiceNow's Server-Timing sem_wait: time our request queued for a worker semaphore.
  readonly semaphoreWaitMs: number;
}

export interface ConcurrencySettings {
  readonly initial?: number;
  readonly min?: number;
  readonly max?: number;
  // Healthy responses needed before allowing one more parallel request.
  readonly healthyStreak?: number;
  readonly semaphoreWaitThresholdMs?: number;
}

// Additive increase, multiplicative decrease (ADR-0016). Requests share the instance's
// small pool of integration workers with everyone else, so pressure halves our share fast
// and trust is regained slowly.
export class ConcurrencyController {
  private current: number;
  private streak = 0;
  private readonly min: number;
  private readonly max: number;
  private readonly healthyStreak: number;
  private readonly threshold: number;

  constructor(settings: ConcurrencySettings = {}) {
    this.min = settings.min ?? 1;
    this.max = settings.max ?? 4;
    this.current = settings.initial ?? 2;
    this.healthyStreak = settings.healthyStreak ?? 20;
    this.threshold = settings.semaphoreWaitThresholdMs ?? 500;
  }

  get limit(): number {
    return this.current;
  }

  observe(signal: ResponseSignal): void {
    const pressured =
      signal.status === 429 || signal.status === 503 || signal.semaphoreWaitMs > this.threshold;
    if (pressured) {
      this.current = Math.max(this.min, Math.floor(this.current / 2));
      this.streak = 0;
      return;
    }
    if (signal.status >= 500) {
      return;
    }
    this.streak += 1;
    if (this.streak >= this.healthyStreak) {
      this.current = Math.min(this.max, this.current + 1);
      this.streak = 0;
    }
  }
}
