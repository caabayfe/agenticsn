import { dlopen, FFIType } from "bun:ffi";
import type { Win32Confinement } from "./windows-confinement";

// The Windows calls behind the worker's low-integrity sandbox (ADR-0055, step 1), through bun:ffi
// against kernel32 and advapi32: system libraries, no native add-on (ADR-0005). Loaded only on
// Windows, in the worker. Layouts are x64, the one Windows build snagentic ships.

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8;
const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const TOKEN_QUERY = 0x8;
const TOKEN_ADJUST_DEFAULT = 0x80;
const TOKEN_INTEGRITY_LEVEL = 25;
const SE_GROUP_INTEGRITY = 0x20;
const SDDL_REVISION_1 = 1;
const SE_FILE_OBJECT = 1;
const LABEL_SECURITY_INFORMATION = 0x10;
const CURRENT_PROCESS = 0xffff_ffff_ffff_ffffn;
const LOW_INTEGRITY_SID = "S-1-16-4096";
// A low mandatory label that folders pass on to what they hold, now and later: low-integrity
// processes may write there (no-write-up stops them everywhere else).
const LOW_LABEL = "S:(ML;OICI;NW;;;LW)";

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION: one process (the worker: no child processes), killed when
// the job closes, and no error dialog that would keep a crashed worker alive.
export function jobLimits(): Uint8Array {
  const buffer = new Uint8Array(144);
  const view = new DataView(buffer.buffer);
  const flags =
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION |
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
  view.setUint32(16, flags, true);
  view.setUint32(40, 1, true);
  return buffer;
}

// TOKEN_MANDATORY_LABEL: the SID's address and SE_GROUP_INTEGRITY, in a buffer as long as the
// length SetTokenInformation is told (the structure plus the SID's length, as Windows expects).
export function mandatoryLabel(sid: bigint, sidLength = 0): Uint8Array {
  const buffer = new Uint8Array(16 + sidLength);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(0, sid, true);
  view.setUint32(8, SE_GROUP_INTEGRITY, true);
  return buffer;
}

export const wide = (text: string): Uint8Array => Buffer.from(`${text}\0`, "utf16le");

const { u64, u32, i32, ptr } = FFIType;

function libraries() {
  const kernel32 = dlopen("kernel32.dll", {
    CreateJobObjectW: { args: [ptr, ptr], returns: u64 },
    SetInformationJobObject: { args: [u64, u32, ptr, u32], returns: i32 },
    AssignProcessToJobObject: { args: [u64, u64], returns: i32 },
    CloseHandle: { args: [u64], returns: i32 },
    LocalFree: { args: [u64], returns: u64 },
  });
  const advapi32 = dlopen("advapi32.dll", {
    OpenProcessToken: { args: [u64, u32, ptr], returns: i32 },
    ConvertStringSidToSidW: { args: [ptr, ptr], returns: i32 },
    GetLengthSid: { args: [u64], returns: u32 },
    SetTokenInformation: { args: [u64, u32, ptr, u32], returns: i32 },
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {
      args: [ptr, u32, ptr, ptr],
      returns: i32,
    },
    GetSecurityDescriptorSacl: { args: [u64, ptr, ptr, ptr], returns: i32 },
    SetNamedSecurityInfoW: { args: [ptr, u32, u32, ptr, ptr, ptr, u64], returns: u32 },
  });
  return { kernel32: kernel32.symbols, advapi32: advapi32.symbols };
}

type Libraries = ReturnType<typeof libraries>;

const succeeded = (name: string, result: number | bigint): void => {
  if (result === 0 || result === 0n) throw new Error(`${name} failed`);
};

const out = () => new BigUint64Array(1);
const value = (cell: BigUint64Array): bigint => cell.at(0) ?? 0n;

function labelLowIntegrity({ kernel32, advapi32 }: Libraries, folder: string): void {
  const descriptor = out();
  succeeded(
    "ConvertStringSecurityDescriptorToSecurityDescriptorW",
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
      wide(LOW_LABEL),
      SDDL_REVISION_1,
      descriptor,
      null,
    ),
  );
  try {
    const sacl = out();
    const [present, defaulted] = [new Int32Array(1), new Int32Array(1)];
    succeeded(
      "GetSecurityDescriptorSacl",
      advapi32.GetSecurityDescriptorSacl(value(descriptor), present, sacl, defaulted),
    );
    // Returns the error code itself; it also relabels what the folder already holds.
    const code = advapi32.SetNamedSecurityInfoW(
      wide(folder),
      SE_FILE_OBJECT,
      LABEL_SECURITY_INFORMATION,
      null,
      null,
      null,
      value(sacl),
    );
    if (code !== 0) throw new Error(`SetNamedSecurityInfoW failed (${code}) on ${folder}`);
  } finally {
    kernel32.LocalFree(value(descriptor));
  }
}

// The handle stays open for the worker's life: closing the job would kill the worker.
function joinJobWithoutChildren({ kernel32 }: Libraries): void {
  const job = kernel32.CreateJobObjectW(null, null);
  succeeded("CreateJobObjectW", job);
  const limits = jobLimits();
  succeeded(
    "SetInformationJobObject",
    kernel32.SetInformationJobObject(
      job,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
      limits,
      limits.byteLength,
    ),
  );
  succeeded("AssignProcessToJobObject", kernel32.AssignProcessToJobObject(job, CURRENT_PROCESS));
}

function lowerToLowIntegrity({ kernel32, advapi32 }: Libraries): void {
  const token = out();
  succeeded(
    "OpenProcessToken",
    advapi32.OpenProcessToken(CURRENT_PROCESS, TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, token),
  );
  const sid = out();
  try {
    succeeded(
      "ConvertStringSidToSidW",
      advapi32.ConvertStringSidToSidW(wide(LOW_INTEGRITY_SID), sid),
    );
    const label = mandatoryLabel(value(sid), advapi32.GetLengthSid(value(sid)));
    succeeded(
      "SetTokenInformation",
      advapi32.SetTokenInformation(value(token), TOKEN_INTEGRITY_LEVEL, label, label.byteLength),
    );
  } finally {
    if (value(sid) !== 0n) kernel32.LocalFree(value(sid));
    kernel32.CloseHandle(value(token));
  }
}

export function win32Confinement(): Win32Confinement {
  const loaded = libraries();
  return {
    labelLowIntegrity: (folder) => labelLowIntegrity(loaded, folder),
    joinJobWithoutChildren: () => joinJobWithoutChildren(loaded),
    lowerToLowIntegrity: () => lowerToLowIntegrity(loaded),
  };
}
