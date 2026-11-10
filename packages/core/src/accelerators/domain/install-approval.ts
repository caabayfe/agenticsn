import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { InstallApproval, InstallPlan } from "./install-plan";

// What the admin approved, apart from the instance (spec 014, F7). The plan id also hashes the
// instance's state (mirror commit, component states, fields, open update sets), which a stopped
// run changes itself; this leaves those out, so a resume can tell the pack changing from the
// instance moving on.
export function installApproval(plan: InstallPlan): InstallApproval {
  const content = canonicalJson({
    selection: {
      profile: plan.selection.profile ?? null,
      modules: [...(plan.selection.modules ?? [])],
    },
    modules: plan.modules.map((m) => ({
      id: m.id,
      label: m.label,
      dependsOn: [...m.dependsOn],
      files: [...m.files],
    })),
    demoOnly: [...plan.demoOnly],
    demoSettings: plan.demoSettings,
    data: {
      source: plan.data.source,
      entities: plan.data.entities.map((e) => ({ entity: e.entity, rows: e.rows })),
    },
    // The selected modules' source files, by path and hash.
    source: plan.basis.content,
  });
  return {
    pack: plan.pack,
    version: plan.version,
    modules: plan.modules.map((m) => m.id),
    content: sha256Hex(content),
  };
}

// What changed between the approved plan and the one a resume would run, in words; empty when
// the resume runs the approved plan.
export function approvalChanges(approved: InstallApproval, now: InstallApproval): string[] {
  const changes: string[] = [];
  if (approved.pack !== now.pack) changes.push(`pack ${approved.pack} is now ${now.pack}`);
  if (approved.version !== now.version)
    changes.push(`version ${approved.version} is now ${now.version}`);
  const before = approved.modules.join(", ");
  const after = now.modules.join(", ");
  if (before !== after) changes.push(`modules ${before} are now ${after || "none"}`);
  if (changes.length === 0 && approved.content !== now.content)
    changes.push("the modules' content (source, data or settings) changed");
  return changes;
}
