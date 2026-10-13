import { SnagenticError } from "@snagentic/core";

// ADR-0024: why an elevated session could not be opened. Every hint ends with the manual path,
// so a push that cannot elevate still tells the person how to deliver the ACL.
const MANUAL =
  "or create the ACL on the instance (elevated) in this branch's update set, remove its file, then pull and integrate";

export class BrowserUnavailableError extends SnagenticError {
  constructor(reason: string) {
    super(
      "browser-unavailable",
      "precondition",
      `writing ACLs needs Google Chrome or Microsoft Edge, and neither could be started: ${reason}`,
      `install Google Chrome, then push again; ${MANUAL}`,
    );
  }
}

export class SignInUnsupportedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "sign-in-unsupported",
      "precondition",
      `${instance}'s login page has no password form (single sign-on?), so snagentic cannot sign in to elevate`,
      `signing in through single sign-on is not supported yet (ADR-0024); ${MANUAL}`,
    );
  }
}

export class SignInFailedError extends SnagenticError {
  constructor(instance: string, reason: string) {
    super(
      "sign-in-failed",
      "precondition",
      `signing in to ${instance} in the browser failed: ${reason}`,
      `check the password with snagentic auth login ${instance} --allow-elevation; ${MANUAL}`,
    );
  }
}

export class ElevationFailedError extends SnagenticError {
  constructor(instance: string, reason: string) {
    super(
      "elevation-failed",
      "precondition",
      `elevating to security_admin on ${instance} failed: ${reason}`,
      `check the user holds security_admin and can elevate (System Security > Elevated roles); ${MANUAL}`,
    );
  }
}
