// A minimal Chrome DevTools Protocol client over the browser's WebSocket: commands with
// replies, and events by name, on one attached page session.
type Message = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
  readonly sessionId?: string;
};

export class DevToolsClient {
  private next = 0;
  private readonly replies = new Map<number, (message: Message) => void>();
  private readonly listeners = new Map<string, ((params: unknown) => void)[]>();
  private session: string | undefined;

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)));
  }

  static async connect(url: string): Promise<DevToolsClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`cannot connect to the browser at ${url}`));
    });
    return new DevToolsClient(socket);
  }

  private receive(message: Message): void {
    if (message.id !== undefined) {
      this.replies.get(message.id)?.(message);
      this.replies.delete(message.id);
    } else if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params);
      }
    }
  }

  // Sends a command (to the attached page once there is one) and waits for its result.
  send(method: string, params: Record<string, unknown> = {}, browser = false): Promise<unknown> {
    const id = ++this.next;
    const sessionId = browser ? undefined : this.session;
    return new Promise((resolve, reject) => {
      this.replies.set(id, (message) =>
        message.error === undefined
          ? resolve(message.result)
          : reject(new Error(`${method}: ${message.error.message}`)),
      );
      this.socket.send(
        JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
      );
    });
  }

  on(method: string, listener: (params: unknown) => void): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  once(method: string): Promise<unknown> {
    return new Promise((resolve) => {
      const listener = (params: unknown) => {
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((item) => item !== listener),
        );
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  async attachPage(): Promise<void> {
    const created = await this.send("Target.createTarget", { url: "about:blank" }, true);
    const targetId = field(created, "targetId");
    const attached = await this.send("Target.attachToTarget", { targetId, flatten: true }, true);
    this.session = field(attached, "sessionId");
  }

  close(): void {
    this.socket.close();
  }
}

export function field(value: unknown, name: string): string {
  const found = typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  return typeof found === "string" ? found : "";
}
