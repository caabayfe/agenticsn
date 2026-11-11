import { describe, expect, it } from "bun:test";
import { jobLimits, mandatoryLabel, wide } from "../../../src/adapters/fluent/win32-calls";
import {
  confineWorker,
  LOW_INTEGRITY_FOLDERS,
  type Win32Confinement,
} from "../../../src/adapters/fluent/windows-confinement";

// ADR-0055 step 1: on Windows the worker confines itself, before it sees the project.

function recording(failing?: string) {
  const calls: string[] = [];
  const step = (name: string) => {
    if (name === failing) throw new Error(`${name} failed`);
    calls.push(name);
  };
  const confinement: Win32Confinement = {
    labelLowIntegrity: (folder) => step(`label ${folder}`),
    joinJobWithoutChildren: () => step("job"),
    lowerToLowIntegrity: () => step("lower"),
  };
  return { calls, load: () => confinement };
}

const asked = (folders: unknown) => ({ [LOW_INTEGRITY_FOLDERS]: JSON.stringify(folders) });

describe("the worker's Windows confinement (ADR-0055)", () => {
  it("does nothing when snagentic didn't ask for it", () => {
    const { calls, load } = recording();
    expect(confineWorker({}, load)).toBe("none");
    expect(calls).toEqual([]);
  });

  it("labels its folders writable at low integrity, joins a job, then lowers itself", () => {
    const { calls, load } = recording();
    expect(confineWorker(asked(["C:\\p", "C:\\s"]), load)).toBe("low-integrity");
    expect(calls).toEqual(["label C:\\p", "label C:\\s", "job", "lower"]);
  });

  it("refuses a folder list it can't read, confining nothing", () => {
    for (const value of ["not json", JSON.stringify("C:\\p"), JSON.stringify([]), "[1]"]) {
      const { calls, load } = recording();
      expect(() => confineWorker({ [LOW_INTEGRITY_FOLDERS]: value }, load)).toThrow(
        expect.objectContaining({ code: "worker-confinement-failed" }),
      );
      expect(calls).toEqual([]);
    }
  });

  it("fails, naming the step, when a Windows call fails", () => {
    const { load } = recording("job");
    expect(() => confineWorker(asked(["C:\\p"]), load)).toThrow(
      expect.objectContaining({
        code: "worker-confinement-failed",
        message: expect.stringContaining("job failed"),
      }),
    );
  });
});

describe("the Win32 structures (x64)", () => {
  it("limits the job to the worker alone, killed with the job, dying on a crash", () => {
    const view = new DataView(jobLimits().buffer);
    expect(view.byteLength).toBe(144);
    expect(view.getUint32(16, true)).toBe(0x2000 | 0x400 | 0x8);
    expect(view.getUint32(40, true)).toBe(1);
  });

  it("labels a token with a SID as its integrity level", () => {
    const view = new DataView(mandatoryLabel(0x1234n).buffer);
    expect(view.byteLength).toBe(16);
    expect(view.getBigUint64(0, true)).toBe(0x1234n);
    expect(view.getUint32(8, true)).toBe(0x20);
  });

  it("passes text as a terminated UTF-16 string", () => {
    expect([...wide("S:")]).toEqual([0x53, 0, 0x3a, 0, 0, 0]);
  });
});
