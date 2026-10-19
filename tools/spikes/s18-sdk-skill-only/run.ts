// Spike S18: how far does a coding agent get with only ServiceNow's now-sdk plugin, no snagentic?
// Runs Claude Code headless, one empty folder per run, with the plugin, no MCP server and no
// project instructions, on the prompts of snagentic's evaluation (scripts/eval/scenarios.ts).
// The pdi2 credential reaches the SDK only through the child's environment, as in S16, and is
// scrubbed from every transcript before it is written.
//   bun tools/spikes/s18-sdk-skill-only/run.ts <out dir> [scenario ids...] [--reps N]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
} from "../../../packages/core/src/index";
import { SCENARIOS, type SpikeScenario } from "./scenarios";

const PLUGIN = join(
  process.env["HOME"] ?? "",
  ".claude/plugins/cache/claude-plugins-official/servicenow-sdk/1.2.0",
);
const WORKSPACE = join(import.meta.dir, "../../../../spaces/pdi2");
const MODEL = "sonnet";
const BUDGET_USD = 4;
const TURN_TIMEOUT_SECONDS = 20 * 60;

const ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Skill",
  "TodoWrite",
  "Bash(npx:*)",
  "Bash(npm:*)",
  "Bash(node:*)",
  "Bash(now-sdk:*)",
  "Bash(git:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(mkdir:*)",
  "Bash(find:*)",
  "Bash(grep:*)",
  "Bash(jq:*)",
];

const args = process.argv.slice(2);
const repsAt = args.indexOf("--reps");
const reps = repsAt >= 0 ? Number(args[repsAt + 1]) : 2;
const positional = args.filter((arg, index) => index !== repsAt && index !== repsAt + 1);
const [outDir = "s18-runs", ...only] = positional;
const scenarios = only.length === 0 ? SCENARIOS : SCENARIOS.filter((s) => only.includes(s.id));

const profile = await getInstance(WORKSPACE, InstanceName.parse("pdi2"), new YamlProfileStore());
ensureDevelopmentInstance(profile);
if (profile.auth.method !== "basic") throw new Error("spike supports basic profiles only");
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const scrub = (text: string) => text.split(secret).join("***");

function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/PASSWORD|SECRET|TOKEN/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    SN_SDK_INSTANCE_URL: profile.url,
    SN_SDK_USER: profile.auth.username,
    SN_SDK_USER_PWD: secret,
    SN_SDK_AUTH_TYPE: "basic",
    SN_SDK_NODE_ENV: "SN_SDK_CI_INSTALL",
    NO_TELEMETRY: "1",
  };
}

async function turn(prompt: string, cwd: string, session: string | null) {
  const command = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    MODEL,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--plugin-dir",
    PLUGIN,
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ...ALLOWED,
    "--max-budget-usd",
    String(BUDGET_USD),
    ...(session === null ? [] : ["--resume", session]),
  ];
  const started = Date.now();
  const child = Bun.spawn(command, { cwd, env: environment(), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), TURN_TIMEOUT_SECONDS * 1000);
  const stream = await new Response(child.stdout).text();
  await child.exited;
  clearTimeout(timer);
  return { stream: scrub(stream), seconds: Math.round((Date.now() - started) / 1000) };
}

async function runOne(scenario: SpikeScenario, rep: number): Promise<void> {
  const slot = join(outDir, `${scenario.id}-${rep}`);
  const cwd = join(slot, "work");
  await mkdir(cwd, { recursive: true });
  await scenario.prepare?.(cwd);
  let session: string | null = null;
  for (const [index, prompt] of scenario.turns.entries()) {
    const text = index === 0 ? `${scenario.context ?? CONTEXT}\n\n${prompt}` : prompt;
    const { stream, seconds } = await turn(text, cwd, session);
    await writeFile(join(slot, `turn-${index}.jsonl`), stream);
    await writeFile(join(slot, `turn-${index}.seconds`), String(seconds));
    session = /"session_id":"([^"]+)"/.exec(stream)?.[1] ?? session;
    console.log(`${scenario.id}-${rep} turn ${index}: ${seconds}s`);
  }
}

const CONTEXT = [
  `(Context: my ServiceNow development instance is ${profile.url}. The ServiceNow SDK is`,
  "already authenticated to it through environment variables; no `now-sdk auth` step is needed.)",
].join(" ");

for (const scenario of scenarios) {
  for (let rep = 1; rep <= reps; rep++) {
    await runOne(scenario, rep);
  }
}
