import { AsyncEntry } from "@napi-rs/keyring";
import type { EnvironmentProbe } from "@snagentic/core";
import { failedCheck, okCheck, unavailableCheck } from "./check-results";

export interface KeychainEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined | null>;
  deletePassword(): Promise<boolean>;
}

export type CreateKeychainEntry = (service: string, account: string) => KeychainEntry;

const NAME = "keychain";
const SERVICE = "snagentic-doctor";
const STORE_NAMES: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: "macOS Keychain",
  win32: "Windows Credential Manager",
  linux: "Secret Service",
};

async function removeQuietly(entry: KeychainEntry): Promise<void> {
  try {
    await entry.deletePassword();
  } catch {
    // Best effort: the probe entry holds a random value, never a real credential.
  }
}

// Writes, reads back and deletes a random value under a dedicated service name. It never
// touches stored credentials.
export function keychainProbe(
  createEntry: CreateKeychainEntry = (service, account) => new AsyncEntry(service, account),
  platform: NodeJS.Platform = process.platform,
): EnvironmentProbe {
  const store = STORE_NAMES[platform] ?? "OS credential store";
  return {
    name: NAME,
    async run() {
      let entry: KeychainEntry | undefined;
      const secret = crypto.randomUUID();
      try {
        // Creating the entry can itself throw (for example Linux without a D-Bus session).
        entry = createEntry(SERVICE, `probe-${crypto.randomUUID()}`);
        await entry.setPassword(secret);
        const readBack = await entry.getPassword();
        await entry.deletePassword();
        if (readBack !== secret) {
          return failedCheck(NAME, `${store} returned a different value`, "check the keychain");
        }
        return okCheck(NAME, `${store}: write, read and delete succeeded`);
      } catch (error) {
        if (entry !== undefined) {
          await removeQuietly(entry);
        }
        const reason = error instanceof Error ? error.message : String(error);
        if (platform === "linux") {
          return unavailableCheck(
            NAME,
            `${store} is not available: ${reason}`,
            "on servers and CI, provide credentials through environment variables instead",
          );
        }
        return failedCheck(
          NAME,
          `${store} refused access: ${reason}`,
          `allow snagentic to use the ${store}`,
        );
      }
    },
  };
}
