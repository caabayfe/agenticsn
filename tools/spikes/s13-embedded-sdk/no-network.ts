// Spike S13, test A7: the embedded build makes no outbound connection.
//   bun no-network.ts <binary> <project dir>
// Each run is inside a macOS sandbox that denies all outbound network except a local recording
// proxy. The proxy logs what a client asks for (CONNECT host:port) and refuses it, so nothing
// leaves the machine even in the control run.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.argv[2] ?? "./embed-bin");
const project = resolve(process.argv[3] ?? ".");
const requests: string[] = [];

const proxy = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, data) {
      requests.push(data.toString("latin1").split("\r\n")[0] ?? "");
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    },
  },
});
const work = mkdtempSync(join(tmpdir(), "s13-a7-"));
const profile = join(work, "no-network.sb");
writeFileSync(
  profile,
  [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    `(allow network-outbound (remote ip "localhost:${proxy.port}"))`,
  ].join("\n"),
);

async function sandboxed(label: string, command: string[], env: Record<string, string>) {
  const before = requests.length;
  const run = Bun.spawn(["sandbox-exec", "-f", profile, ...command], {
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  const last = `${out}${err}`.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
  console.log(`\n## ${label}\nexit ${code}; last line: ${last.slice(0, 160)}`);
  console.log(`proxy saw ${requests.length - before}:`, requests.slice(before));
  return code;
}

function copyProject(name: string): string {
  const dir = join(work, name);
  cpSync(project, dir, { recursive: true, filter: (p) => !p.includes("node_modules") });
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  return dir;
}

const proxyUrl = `http://127.0.0.1:${proxy.port}`;
const viaProxy = { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl };

// 1. The sandbox enforces: a direct connection fails, by IP address so DNS is not the reason.
await sandboxed("control: direct connection", ["curl", "-sS", "-m", "5", "https://1.1.1.1"], {});
// 2. The proxy records: the SDK's own telemetry, left on, is seen and refused.
await sandboxed("control: SDK telemetry on", [binary, copyProject("control")], {
  ...viaProxy,
  S13_TELEMETRY_CONTROL: "1",
});
// 3. The test: snagentic's build, with proxy variables set and without.
await sandboxed("A7: build, proxy variables set", [binary, copyProject("proxy")], viaProxy);
await sandboxed("A7: build, no proxy variables", [binary, copyProject("bare")], {});

proxy.stop(true);
rmSync(work, { recursive: true, force: true });
