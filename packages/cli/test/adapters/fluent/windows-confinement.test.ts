import { describe, expect, it } from "bun:test";
import {
  jobLimits,
  loadWin32Libraries,
  mandatoryLabel,
  type Win32Libraries,
  wide,
  win32Confinement,
} from "../../../src/adapters/fluent/win32-calls";
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

type Out = Uint8Array | BigUint64Array | Int32Array | null;

// Windows as the worker sees it through bun:ffi, recording each call; `failing` returns 0 from one.
function fakeWindows(failing?: string, labelCode = 0) {
  const calls: string[] = [];
  const result = (name: string, ok: number) => {
    calls.push(name);
    return name === failing ? 0 : ok;
  };
  const fill = (cell: Out, address: bigint) => {
    if (cell instanceof BigUint64Array) cell[0] = address;
  };
  const libraries: Win32Libraries = {
    kernel32: {
      CreateJobObjectW: () => BigInt(result("CreateJobObjectW", 0x40)),
      SetInformationJobObject: (_job, kind, info, length) =>
        result(`SetInformationJobObject ${kind} ${info?.byteLength} ${length}`, 1),
      AssignProcessToJobObject: (job, process) =>
        result(`AssignProcessToJobObject ${job} ${process === 2n ** 64n - 1n}`, 1),
      CloseHandle: (handle) => result(`CloseHandle ${handle}`, 1),
      LocalFree: (memory) => BigInt(result(`LocalFree ${memory}`, 0)),
    },
    advapi32: {
      OpenProcessToken: (_process, access, token) => {
        fill(token, 0x70n);
        return result(`OpenProcessToken ${access}`, 1);
      },
      ConvertStringSidToSidW: (_text, sid) => {
        fill(sid, 0x51n);
        return result("ConvertStringSidToSidW", 1);
      },
      GetLengthSid: () => 12,
      SetTokenInformation: (token, kind, info, length) =>
        result(`SetTokenInformation ${token} ${kind} ${info?.byteLength} ${length}`, 1),
      ConvertStringSecurityDescriptorToSecurityDescriptorW: (_text, revision, descriptor) => {
        fill(descriptor, 0x5dn);
        return result(`ConvertStringSecurityDescriptor ${revision}`, 1);
      },
      GetSecurityDescriptorSacl: (descriptor, _present, sacl) => {
        fill(sacl, 0xac1n);
        return result(`GetSecurityDescriptorSacl ${descriptor}`, 1);
      },
      SetNamedSecurityInfoW: (_name, kind, information, _o, _g, _d, sacl) => {
        calls.push(`SetNamedSecurityInfoW ${kind} ${information} ${sacl}`);
        return labelCode;
      },
    },
  };
  return { calls, confinement: win32Confinement(() => libraries) };
}

describe("the Win32 calls", () => {
  it("labels a folder with the low label's SACL, freeing the descriptor", () => {
    const { calls, confinement } = fakeWindows();
    confinement.labelLowIntegrity("C:\\p");
    expect(calls).toEqual([
      "ConvertStringSecurityDescriptor 1",
      "GetSecurityDescriptorSacl 93",
      "SetNamedSecurityInfoW 1 16 2753",
      "LocalFree 93",
    ]);
  });

  it("fails when the folder can't be labelled, naming it and the code", () => {
    const { calls, confinement } = fakeWindows(undefined, 5);
    expect(() => confinement.labelLowIntegrity("C:\\p")).toThrow(
      "SetNamedSecurityInfoW failed (5) on C:\\p",
    );
    expect(calls).toContain("LocalFree 93");
  });

  it("puts the worker itself in a job with its limits", () => {
    const { calls, confinement } = fakeWindows();
    confinement.joinJobWithoutChildren();
    expect(calls).toEqual([
      "CreateJobObjectW",
      "SetInformationJobObject 9 144 144",
      "AssignProcessToJobObject 64 true",
    ]);
  });

  it("fails when the job can't be made", () => {
    expect(() => fakeWindows("CreateJobObjectW").confinement.joinJobWithoutChildren()).toThrow(
      "CreateJobObjectW failed",
    );
  });

  it("sets its own token's integrity to the low SID, then frees the SID and the token", () => {
    const { calls, confinement } = fakeWindows();
    confinement.lowerToLowIntegrity();
    expect(calls).toEqual([
      `OpenProcessToken ${0x8 | 0x80}`,
      "ConvertStringSidToSidW",
      "SetTokenInformation 112 25 28 28",
      "LocalFree 81",
      "CloseHandle 112",
    ]);
  });

  it("closes the token even when lowering fails", () => {
    const { calls, confinement } = fakeWindows("ConvertStringSidToSidW");
    expect(() => confinement.lowerToLowIntegrity()).toThrow("ConvertStringSidToSidW failed");
    expect(calls.at(-1)).toBe("CloseHandle 112");
  });

  it("loads kernel32 and advapi32 on Windows, and nowhere else", () => {
    if (process.platform === "win32") {
      expect(typeof loadWin32Libraries().advapi32.SetTokenInformation).toBe("function");
    } else {
      expect(() => loadWin32Libraries()).toThrow();
    }
  });
});
