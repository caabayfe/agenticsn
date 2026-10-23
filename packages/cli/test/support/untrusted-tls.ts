import { join } from "node:path";

const TLS = join(import.meta.dir, "../../../../tests/fixtures/tls");

// An HTTPS server with a self-signed certificate: a client that checks certificates refuses it.
export function untrustedServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    hostname: "localhost",
    tls: {
      key: Bun.file(join(TLS, "localhost-key.pem")),
      cert: Bun.file(join(TLS, "localhost-cert.pem")),
    },
    fetch: () => new Response("credentials accepted"),
  });
}

// Runs `body` with certificate checks turned off in the environment, as a hostile .env or shell
// would, then puts the variable back.
export async function withTlsChecksOff(body: () => unknown): Promise<void> {
  const before = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  try {
    await body();
  } finally {
    if (before === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = before;
  }
}
