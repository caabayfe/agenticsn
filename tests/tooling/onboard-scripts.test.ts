import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { USE_CASES } from "../../packages/cli/src/registry/registry";
import { qualifiedName } from "../../packages/cli/src/registry/use-case";

// The accelerator team's onboarding scripts (scripts/onboard). They call snagentic commands, so a
// renamed command fails here, not on someone's first day. The PowerShell one can't be parsed on a
// machine without PowerShell; its commands are checked, its syntax is not.
const DIR = join(import.meta.dir, "../../scripts/onboard");
const COMMANDS = [
  "init",
  "instance add",
  "auth login",
  "auth logout",
  "doctor",
  "pull",
  "integrate",
  "accelerator install",
];
const registered = new Set(USE_CASES.map(qualifiedName));
const words = (command: string) => command.split(" ").join("\\s+");

// PowerShell passes arguments as @('instance', 'add', ...): drop the quoting before looking.
const bash = readFileSync(join(DIR, "onboard-pdi.sh"), "utf8");
const rawPowershell = readFileSync(join(DIR, "onboard-pdi.ps1"), "utf8");
const powershell = rawPowershell.replace(/['",@()]/g, " ");

describe("onboarding scripts", () => {
  it("is valid bash", () => {
    const result = Bun.spawnSync(["bash", "-n", join(DIR, "onboard-pdi.sh")]);
    expect(result.exitCode).toBe(0);
  });

  for (const command of COMMANDS) {
    it(`calls "snagentic ${command}", which exists`, () => {
      expect(registered.has(command)).toBe(true);
      expect(new RegExp(`"\\$SNAGENTIC"\\s+${words(command)}\\b`).test(bash)).toBe(true);
      expect(new RegExp(`\\$Snagentic\\s+${words(command)}\\b`).test(powershell)).toBe(true);
    });
  }

  it("shows the same questions in both, so a Windows user isn't asked something else", () => {
    for (const question of ["Instance (dev12345", "Profile name, short", "Pack commit or branch"]) {
      expect(bash).toContain(question);
      expect(rawPowershell).toContain(question);
    }
  });
});
