import {
  AuthenticationFailedError,
  type ConnectionStats,
  InstanceError,
  type InstanceProfile,
  type OAuthClientCredentials,
  SnagenticError,
} from "@snagentic/core";
import {
  type HttpRequest,
  type HttpResponse,
  type SchedulerClock,
  SYSTEM_CLOCK,
} from "./http-types";

// What the client sends through: the request scheduler, with credentials added.
export interface RequestSender {
  send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse>;
  stats(): ConnectionStats;
}

class OAuthGrantUnavailableError extends SnagenticError {
  constructor(instance: string) {
    super(
      "oauth-grant-unavailable",
      "precondition",
      `${instance} does not allow the OAuth client-credentials grant`,
      "set the system property glide.oauth.inbound.client.credential.grant_type.enabled to " +
        "true (Washington DC or later), and give the client an OAuth Application User",
    );
  }
}

// Renew this long before the instance says the token expires, so it never expires in flight.
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_LIFETIME_S = 1800;

interface Token {
  readonly value: string;
  readonly expiresAt: number;
}

function withAuthorization(request: HttpRequest, authorization: string): HttpRequest {
  return { ...request, headers: { ...request.headers, Authorization: authorization } };
}

// The token endpoint's error code, when it is a plain identifier; never the rest of the body.
function oauthError(body: string): string {
  try {
    const parsed: { error?: unknown } = JSON.parse(body);
    return typeof parsed.error === "string" && /^[a-z_]+$/.test(parsed.error) ? parsed.error : "";
  } catch {
    return "";
  }
}

function parseToken(body: string, now: number): Token | null {
  try {
    const parsed: { access_token?: unknown; expires_in?: unknown } = JSON.parse(body);
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") {
      return null;
    }
    const lifetime = Number(parsed.expires_in);
    const seconds = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : DEFAULT_LIFETIME_S;
    return { value: parsed.access_token, expiresAt: now + seconds * 1000 };
  } catch {
    return null;
  }
}

// ADR-0021: a client-credentials token, requested through the scheduler, kept in memory only,
// shared by concurrent requests, renewed before expiry and once after a 401.
class OAuthSender implements RequestSender {
  private current: Promise<Token> | null = null;

  constructor(
    private readonly profile: InstanceProfile,
    private readonly auth: OAuthClientCredentials,
    private readonly secret: string,
    private readonly scheduler: RequestSender,
    private readonly clock: SchedulerClock,
  ) {}

  async send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    const used = await this.token(signal, null);
    const response = await this.scheduler.send(this.signed(request, used), signal);
    if (response.status !== 401) {
      return response;
    }
    await response.text();
    return this.scheduler.send(this.signed(request, await this.token(signal, used)), signal);
  }

  stats(): ConnectionStats {
    return this.scheduler.stats();
  }

  private signed(request: HttpRequest, token: Token): HttpRequest {
    return withAuthorization(request, `Bearer ${token.value}`);
  }

  // The current token, unless it was rejected or is about to expire. Concurrent callers share
  // one token request; when it fails, they all get its error.
  private async token(signal: AbortSignal, rejected: Token | null): Promise<Token> {
    const pending = this.current;
    if (pending !== null) {
      const token = await pending;
      const fresh = this.clock.now() < token.expiresAt - EXPIRY_MARGIN_MS;
      if (token !== rejected && fresh) {
        return token;
      }
      if (this.current !== pending) {
        return this.token(signal, rejected);
      }
    }
    const request = this.fetchToken(signal).catch((error: unknown) => {
      if (this.current === request) {
        this.current = null;
      }
      throw error;
    });
    this.current = request;
    return request;
  }

  private async fetchToken(signal: AbortSignal): Promise<Token> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.auth.clientId,
      client_secret: this.secret,
    }).toString();
    const response = await this.scheduler.send(
      {
        method: "POST",
        url: new URL("/oauth_token.do", this.profile.url).href,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      },
      signal,
    );
    const text = await response.text();
    if (response.status === 400 || response.status === 401) {
      throw oauthError(text) === "unsupported_grant_type"
        ? new OAuthGrantUnavailableError(this.profile.name)
        : new AuthenticationFailedError(this.profile.name);
    }
    const token = response.status === 200 ? parseToken(text, this.clock.now()) : null;
    if (token === null) {
      const transaction = response.headers.get("x-transaction-id") ?? "unknown";
      throw new InstanceError(
        `token request: HTTP ${response.status}, no access token (transaction ${transaction})`,
      );
    }
    return token;
  }
}

class BasicSender implements RequestSender {
  private readonly authorization: string;

  constructor(
    username: string,
    secret: string,
    private readonly scheduler: RequestSender,
  ) {
    this.authorization = `Basic ${btoa(`${username}:${secret}`)}`;
  }

  send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    return this.scheduler.send(withAuthorization(request, this.authorization), signal);
  }

  stats(): ConnectionStats {
    return this.scheduler.stats();
  }
}

export function authorize(
  profile: InstanceProfile,
  secret: string,
  scheduler: RequestSender,
  clock: SchedulerClock = SYSTEM_CLOCK,
): RequestSender {
  const auth = profile.auth;
  return auth.method === "basic"
    ? new BasicSender(auth.username, secret, scheduler)
    : new OAuthSender(profile, auth, secret, scheduler, clock);
}
