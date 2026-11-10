import {
  ConcurrencyController,
  type ConnectionStats,
  InstanceUnreachableError,
  OperationCancelledError,
  parseServerTiming,
  RequestBudgetExhaustedError,
  type RequestOutcome,
  RequestTimedOutError,
  retryDecision,
} from "@snagentic/core";
import type { RequestSender } from "./authorization";
import {
  type HttpRequest,
  type HttpResponse,
  type SchedulerClock,
  SYSTEM_CLOCK,
  type Transport,
  TransportTimeoutError,
} from "./http-types";
import { SlotQueue } from "./slot-queue";

export interface SchedulerSettings {
  readonly controller?: ConcurrencyController;
  readonly clock?: SchedulerClock;
  // Maximum requests of the scheduler's own run (ADR-0016); unlimited when omitted.
  readonly budget?: number;
  // The adaptive controller's ceiling (ADR-0053); used when no controller is given.
  readonly maxConcurrency?: number;
  // Request starts per second, across every run (ADR-0053); unlimited when omitted.
  readonly requestsPerSecond?: number;
}

// One run: the requests of one connection, with its own budget and statistics.
export interface RunSettings {
  readonly budget?: number;
  // Named in the error when the budget runs out.
  readonly budgetVariable?: string;
}

type Attempt = { readonly response: HttpResponse } | { readonly error: unknown };

class RunMeter {
  requests = 0;
  retries = 0;
  timeouts = 0;
  semaphoreWaitMs = 0;
  requestMs = 0;
  readonly transactionIds: string[] = [];

  constructor(
    readonly settings: RunSettings,
    public peakConcurrency: number,
  ) {}

  checkBudget(): void {
    const budget = this.settings.budget;
    if (budget !== undefined && this.requests >= budget) {
      throw new RequestBudgetExhaustedError(budget, this.settings.budgetVariable);
    }
  }
}

// One per instance and process: every request to the instance goes through it, whichever use
// case or MCP call sends it, so they share one concurrency limit, one adaptive controller and
// one rate limit (ADR-0016, ADR-0053). Each connection is a run with its own statistics.
export class RequestScheduler {
  private readonly controller: ConcurrencyController;
  private readonly clock: SchedulerClock;
  private readonly slots: SlotQueue;
  private readonly own: RunMeter;
  private nextStart = 0;

  constructor(
    private readonly transport: Transport,
    private readonly settings: SchedulerSettings = {},
  ) {
    this.controller =
      settings.controller ??
      new ConcurrencyController(
        settings.maxConcurrency === undefined ? {} : { max: settings.maxConcurrency },
      );
    this.clock = settings.clock ?? SYSTEM_CLOCK;
    this.slots = new SlotQueue(() => this.controller.limit);
    this.own = this.meter(settings.budget === undefined ? {} : { budget: settings.budget });
  }

  send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    return this.sendFor(this.own, request, signal);
  }

  stats(): ConnectionStats {
    return this.statsOf(this.own);
  }

  // A new run through this scheduler: its requests share the instance's limits, and are
  // counted and budgeted on their own.
  run(settings: RunSettings = {}): RequestSender {
    const meter = this.meter(settings);
    return {
      send: (request, signal) => this.sendFor(meter, request, signal),
      stats: () => this.statsOf(meter),
    };
  }

  private meter(settings: RunSettings): RunMeter {
    return new RunMeter(settings, this.controller.limit);
  }

  private async sendFor(
    meter: RunMeter,
    request: HttpRequest,
    signal: AbortSignal,
  ): Promise<HttpResponse> {
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.attempt(meter, request, signal);
      const decision = retryDecision({
        method: request.method,
        attempt,
        outcome: this.outcomeOf(result),
        nowMs: this.clock.now(),
        random: this.clock.random,
        ...(request.retryTimeout === false ? { retryTimeout: false } : {}),
      });
      if (!decision.retry) {
        return this.finish(request, result);
      }
      meter.retries += 1;
      if ("response" in result) {
        await result.response.text().catch(() => "");
      }
      await this.clock.sleep(decision.delayMs, signal).catch(() => {
        throw new OperationCancelledError();
      });
    }
  }

  private statsOf(meter: RunMeter): ConnectionStats {
    return {
      requests: meter.requests,
      retries: meter.retries,
      semaphoreWaitMs: meter.semaphoreWaitMs,
      transactionIds: [...meter.transactionIds],
      concurrencyLimit: this.controller.limit,
      peakConcurrency: meter.peakConcurrency,
      requestMs: Math.round(meter.requestMs),
      timeouts: meter.timeouts,
    };
  }

  private async attempt(
    meter: RunMeter,
    request: HttpRequest,
    signal: AbortSignal,
  ): Promise<Attempt> {
    meter.checkBudget();
    await this.slots.acquire(signal);
    try {
      await this.pace(signal);
      // Cancelled while waiting for the slot: never send.
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      meter.requests += 1;
      const started = this.clock.now();
      try {
        const response = await this.transport(request, signal);
        this.record(meter, response);
        return { response };
      } finally {
        meter.requestMs += this.clock.now() - started;
      }
    } catch (error) {
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      if (error instanceof TransportTimeoutError) {
        meter.timeouts += 1;
        this.controller.timedOut();
      }
      return { error };
    } finally {
      this.slots.release();
    }
  }

  // Spaces request starts to the requests-per-second limit, across every run.
  private async pace(signal: AbortSignal): Promise<void> {
    const perSecond = this.settings.requestsPerSecond;
    if (perSecond === undefined) {
      return;
    }
    const now = this.clock.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + 1000 / perSecond;
    if (start > now) {
      await this.clock.sleep(start - now, signal);
    }
  }

  private record(meter: RunMeter, response: HttpResponse): void {
    const semaphoreWaitMs =
      parseServerTiming(response.headers.get("server-timing"))["sem_wait"] ?? 0;
    meter.semaphoreWaitMs += semaphoreWaitMs;
    const transactionId = response.headers.get("x-transaction-id");
    if (transactionId !== null) {
      meter.transactionIds.push(transactionId);
    }
    this.controller.observe({ status: response.status, semaphoreWaitMs });
    meter.peakConcurrency = Math.max(meter.peakConcurrency, this.controller.limit);
  }

  private outcomeOf(result: Attempt): RequestOutcome {
    if ("response" in result) {
      return {
        status: result.response.status,
        retryAfter: result.response.headers.get("retry-after"),
      };
    }
    return result.error instanceof TransportTimeoutError
      ? { networkError: true, timedOut: true }
      : { networkError: true };
  }

  private finish(request: HttpRequest, result: Attempt): HttpResponse {
    if ("response" in result) {
      return result.response;
    }
    const origin = new URL(request.url).origin;
    if (result.error instanceof TransportTimeoutError) {
      throw new RequestTimedOutError(origin);
    }
    const reason = result.error instanceof Error ? result.error.message : String(result.error);
    throw new InstanceUnreachableError(origin, reason);
  }
}
