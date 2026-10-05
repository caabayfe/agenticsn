import {
  ConcurrencyController,
  type ConnectionStats,
  InstanceUnreachableError,
  OperationCancelledError,
  parseServerTiming,
  RequestBudgetExhaustedError,
  type RequestOutcome,
  retryDecision,
} from "@snagentic/core";
import {
  type HttpRequest,
  type HttpResponse,
  type SchedulerClock,
  SYSTEM_CLOCK,
  type Transport,
} from "./http-types";
import { SlotQueue } from "./slot-queue";

export interface SchedulerSettings {
  readonly controller?: ConcurrencyController;
  readonly clock?: SchedulerClock;
  // Maximum requests per run (ADR-0016); unlimited when omitted.
  readonly budget?: number;
}

type Attempt = { readonly response: HttpResponse } | { readonly error: unknown };

// One per instance and process: every request to the instance goes through it (ADR-0016).
export class RequestScheduler {
  private readonly controller: ConcurrencyController;
  private readonly clock: SchedulerClock;
  private readonly slots: SlotQueue;
  private requests = 0;
  private retries = 0;
  private semaphoreWaitMs = 0;
  private requestMs = 0;
  private peakConcurrency: number;
  private readonly transactionIds: string[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly settings: SchedulerSettings = {},
  ) {
    this.controller = settings.controller ?? new ConcurrencyController();
    this.clock = settings.clock ?? SYSTEM_CLOCK;
    this.slots = new SlotQueue(() => this.controller.limit);
    this.peakConcurrency = this.controller.limit;
  }

  async send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.attempt(request, signal);
      const outcome = this.outcomeOf(result);
      const decision = retryDecision({
        method: request.method,
        attempt,
        outcome,
        nowMs: this.clock.now(),
        random: this.clock.random,
      });
      if (!decision.retry) {
        return this.finish(request, result);
      }
      this.retries += 1;
      if ("response" in result) {
        await result.response.text().catch(() => "");
      }
      await this.clock.sleep(decision.delayMs, signal).catch(() => {
        throw new OperationCancelledError();
      });
    }
  }

  stats(): ConnectionStats {
    return {
      requests: this.requests,
      retries: this.retries,
      semaphoreWaitMs: this.semaphoreWaitMs,
      transactionIds: [...this.transactionIds],
      concurrencyLimit: this.controller.limit,
      peakConcurrency: this.peakConcurrency,
      requestMs: Math.round(this.requestMs),
    };
  }

  private async attempt(request: HttpRequest, signal: AbortSignal): Promise<Attempt> {
    if (this.settings.budget !== undefined && this.requests >= this.settings.budget) {
      throw new RequestBudgetExhaustedError(this.settings.budget);
    }
    await this.slots.acquire(signal);
    try {
      // Cancelled while waiting for the slot: never send.
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      this.requests += 1;
      const started = this.clock.now();
      try {
        const response = await this.transport(request, signal);
        this.record(response);
        return { response };
      } finally {
        this.requestMs += this.clock.now() - started;
      }
    } catch (error) {
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      return { error };
    } finally {
      this.slots.release();
    }
  }

  private record(response: HttpResponse): void {
    const semaphoreWaitMs =
      parseServerTiming(response.headers.get("server-timing"))["sem_wait"] ?? 0;
    this.semaphoreWaitMs += semaphoreWaitMs;
    const transactionId = response.headers.get("x-transaction-id");
    if (transactionId !== null) {
      this.transactionIds.push(transactionId);
    }
    this.controller.observe({ status: response.status, semaphoreWaitMs });
    this.peakConcurrency = Math.max(this.peakConcurrency, this.controller.limit);
  }

  private outcomeOf(result: Attempt): RequestOutcome {
    return "response" in result
      ? { status: result.response.status, retryAfter: result.response.headers.get("retry-after") }
      : { networkError: true };
  }

  private finish(request: HttpRequest, result: Attempt): HttpResponse {
    if ("response" in result) {
      return result.response;
    }
    const reason = result.error instanceof Error ? result.error.message : String(result.error);
    throw new InstanceUnreachableError(new URL(request.url).origin, reason);
  }
}
