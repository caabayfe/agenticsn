import type { Check } from "@snagentic/core";

export function okCheck(name: string, detail: string): Check {
  return { name, status: "ok", detail, hint: null };
}

export function failedCheck(name: string, detail: string, hint: string): Check {
  return { name, status: "fail", detail, hint };
}

export function unavailableCheck(name: string, detail: string, hint: string): Check {
  return { name, status: "unavailable", detail, hint };
}
