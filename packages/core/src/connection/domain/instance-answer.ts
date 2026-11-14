import { SnagenticError } from "../../kernel/errors";
import {
  AuthenticationFailedError,
  InstanceHibernatingError,
  InstanceUnreachableError,
  RequestTimedOutError,
} from "./errors";

// What an instance answered to the first read a person asks of it (ADR-0056). The errors the
// connection raises are already typed; this names what a new user should do about each.
export type InstanceAnswer =
  | { readonly outcome: "ready" }
  | {
      readonly outcome: "asleep" | "unauthorized" | "unreachable" | "refused";
      readonly message: string;
      readonly hint: string;
    };

const SLEEPING_HINT =
  "wake the instance: sign in at https://developer.servicenow.com, start it from Manage > Instance, " +
  "wait until it opens in a browser, then run the command again";

const UNAUTHORIZED_HINT = (instance: string): string =>
  `check the password. On an instance of the Brazil release the user also needs the role ` +
  `snc_basic_auth_api_access (User Administration > Users > the user > Roles > Edit), which is ` +
  `what REST Basic authentication asks for. Then run the command again and, if the password is right, ` +
  `run: snagentic doctor --instance ${instance}`;

// Runs the attempt (a sign-in, or the read that checks a stored credential) and names how it
// ended. A bug is not an answer from the instance, so anything that is not a SnagenticError
// passes through.
export async function answerOf(
  instance: string,
  attempt: () => Promise<void>,
): Promise<InstanceAnswer> {
  try {
    await attempt();
    return { outcome: "ready" };
  } catch (error) {
    if (error instanceof InstanceHibernatingError) {
      return { outcome: "asleep", message: error.message, hint: SLEEPING_HINT };
    }
    if (error instanceof AuthenticationFailedError) {
      return {
        outcome: "unauthorized",
        message: `the instance refused the user's sign-in for "${instance}"`,
        hint: UNAUTHORIZED_HINT(instance),
      };
    }
    if (error instanceof InstanceUnreachableError || error instanceof RequestTimedOutError) {
      return { outcome: "unreachable", message: error.message, hint: error.hint };
    }
    if (error instanceof SnagenticError) {
      return { outcome: "refused", message: error.message, hint: error.hint };
    }
    throw error;
  }
}
