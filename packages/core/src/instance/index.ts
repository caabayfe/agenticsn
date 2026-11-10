// Public API of the instance context: profiles, credentials and instance trust.

export { login, logout, resolveAccess, resolveSecret } from "./application/credentials";
export {
  addInstance,
  getInstance,
  listInstances,
  removeInstance,
} from "./application/manage-instances";
export {
  DevelopmentInstanceRequiredError,
  ensureDevelopmentInstance,
  ReadOnlyCredentialOnDevelopmentError,
  ReadOnlyCredentialRequiredError,
  verifyCredentialMatchesKind,
  verifyReadOnlyCredential,
  verifySessionIdentity,
} from "./application/verify-access";
export {
  CredentialsMissingError,
  IdentityMismatchError,
  IdentityUnverifiedError,
  InstanceExistsError,
  InstanceNotFoundError,
  InstanceUrlExistsError,
  InvalidInstanceUrlError,
  ProfileNotTrustedError,
  ReadOnlyAcknowledgementRequiredError,
} from "./domain/errors";
export { normalizeInstanceUrl } from "./domain/instance-url";
export {
  type AuthSettings,
  type BasicAuth,
  canWrite,
  clientIdProblem,
  createProfile,
  credentialAccount,
  credentialVariable,
  credentialVariables,
  DEFAULT_MAX_AGE_MINUTES,
  type DevelopmentProfile,
  INSTANCE_KINDS,
  type InstanceKind,
  type InstanceProfile,
  instanceHost,
  isCredentialVariable,
  maxAgeProblem,
  type NewProfile,
  type OAuthClientCredentials,
  remoteProblem,
  type SharedMirrorSetting,
  secretName,
  usernameProblem,
} from "./domain/profile";
export {
  type CredentialSource,
  type StoredCredential,
  type TrustedSettings,
  trustedSecret,
  trustProblems,
  untrustedHint,
} from "./domain/trust";
export type { CredentialStore, ProfileStore } from "./ports";
