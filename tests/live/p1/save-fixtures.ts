import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactSecrets } from "../../../packages/core/src/index";

const [root = ""] = process.argv.slice(2);
if (!root) throw new Error("acceptance workspace required");
const destination = resolve(import.meta.dir, "../../fixtures/p1-delivery/pdi11-2026-11-14");
const files = readdirSync(join(root, "acceptance/built")).filter((file) =>
  /^sys_hub_(flow|action_type_definition)_[a-f0-9]{32}\.xml$/.test(file),
);
if (files.length !== 3) throw new Error("expected exactly the three acceptance definitions");
const updateSet = "e9c0017dc3a057109176f3cc05013150";
for (const file of files) {
  const built = readFileSync(join(root, "acceptance/built", file), "utf8");
  const payload = readFileSync(
    join(root, "acceptance/captured", `${file.slice(0, -4)}-${updateSet}.xml`),
    "utf8",
  );
  const sanitized = redactSecrets(payload)
    .replace(/<(sys_created_by|sys_updated_by)>[^<]*<\/\1>/g, "<$1>acceptance_user</$1>")
    .replace(/<(sys_created_on|sys_updated_on)>[^<]*<\/\1>/g, "<$1>2026-11-14 00:00:00</$1>");
  const copies: readonly (readonly [string, string])[] = [
    ["built", built],
    ["captured", sanitized],
  ];
  for (const [folder, content] of copies) {
    mkdirSync(join(destination, folder), { recursive: true });
    writeFileSync(join(destination, folder, file), content);
  }
}
console.log(JSON.stringify({ destination, fixtures: files.length }));
