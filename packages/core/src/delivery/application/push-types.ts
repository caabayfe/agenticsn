import type { LedgerEntry } from "../../authoring/domain/ledger";
import type { PlannedUnit } from "../domain/unit-plan";
import type { CaptureDecoder, FluentInstaller, PushJournal, PushJournalStore } from "../ports";
import type { InstanceSession } from "./push-steps";

export interface ProjectRun {
  readonly session: InstanceSession;
  readonly installer: FluentInstaller;
  readonly decodeCapture: CaptureDecoder;
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
  readonly username: string;
  readonly user: string;
  readonly label: string;
  readonly batch: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly now: () => Date;
}

export interface PushedUnit {
  readonly project: string;
  readonly updateName: string;
  readonly table: string;
  readonly name: string;
  readonly operation: PlannedUnit["operation"];
  readonly captured: boolean;
  readonly applied: boolean;
  readonly refused: string | null;
  readonly mismatches: readonly string[];
}

export interface ProjectPush {
  readonly updateSet: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly units: readonly PushedUnit[];
  readonly ledger: ReadonlyMap<string, LedgerEntry | undefined>;
}
