// A stand-in for the SDK worker that speaks its protocol and misbehaves on purpose, as project
// code in a real worker could. The project folder's mode.json says how (worker-runtime tests).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Mode {
  readonly mode: string;
  readonly target?: string;
  readonly url?: string;
}

const send = (message: unknown): void => {
  process.send?.(message);
};
const tryWrite = (path: string) => {
  try {
    writeFileSync(path, "x");
    return "written";
  } catch (error) {
    return `refused ${String(Reflect.get(Object(error), "code"))}`;
  }
};
const tryFetch = (url: string) =>
  fetch(url).then(
    () => "reached",
    () => "refused",
  );

async function job(message: Record<string, unknown>): Promise<void> {
  const dir = String(message["projectDir"]);
  const {
    mode,
    target = "",
    url = "",
  }: Mode = JSON.parse(readFileSync(join(dir, "mode.json"), "utf8"));
  if (mode === "env")
    return send({ kind: "built", outcome: { success: true, records: Object.keys(process.env) } });
  if (mode === "escape") {
    const records = [
      tryWrite(join(target, "escaped.txt")),
      await tryFetch(url),
      tryWrite(join(dir, "inside.txt")),
    ];
    return send({ kind: "built", outcome: { success: true, records } });
  }
  if (mode === "outside")
    return send({ kind: "built", outcome: { success: true, records: ["../escape.xml"] } });
  if (mode === "garbage") return send({ kind: "built", outcome: { success: "yes" } });
  if (mode === "crash") process.exit(7);
  if (mode === "ask") return send({ kind: "ask", id: 1, request: { method: "POST", url } });
  if (mode === "read") return send({ kind: "ask", id: 1, request: { method: "GET", url } });
}

let building = false;
const failure = (text: string) =>
  building
    ? {
        kind: "built",
        outcome: {
          success: false,
          errors: [{ file: "", line: 1, column: 1, code: "x", message: text }],
        },
      }
    : { kind: "transformed", outcome: { success: false, message: text } };

process.on("disconnect", () => process.exit(0));
process.on("message", (message: Record<string, unknown>) => {
  if (message["kind"] === "build" || message["kind"] === "transform") {
    building = message["kind"] === "build";
    void job(message);
  }
  if (message["kind"] === "answer") {
    const answer = Object(message["answer"]);
    send({ kind: "transformed", outcome: { success: true, files: [String(answer.text)] } });
  }
  if (message["kind"] === "answer-failed") {
    send(failure(String(message["message"])));
  }
});
send({ kind: "ready" });
