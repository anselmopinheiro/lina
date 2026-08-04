import {
  shouldShowPureLocalApiKey,
  type PureLocalProviderId,
} from "./pureLocalSettingsModel";

export type CredentialDomain = "analysis" | "embeddings";

export interface CredentialRef {
  deviceId: string;
  domain: CredentialDomain;
}

export interface CredentialAvailability {
  required: boolean;
  available: boolean;
}

/** Presence-only inputs. Values from persisted settings never enter this model. */
export interface PersistedCredentialPresence {
  analysisDevice: boolean;
  embeddingsDevice: boolean;
  legacyAi: boolean;
  legacyEmbedding: boolean;
}

export type SafeCredentialError = "save-failed" | "clear-failed";

export type CredentialMutationResult =
  | { ok: true; available: true }
  | { ok: true; available: false }
  | { ok: false; error: SafeCredentialError };

/** Read boundary available to declarative settings and action descriptors. */
export interface CredentialStatusPort {
  getAvailability(ref: CredentialRef, provider: PureLocalProviderId): CredentialAvailability;
}

/** Future runtime-only mutation boundary. It never returns the submitted value. */
export interface CredentialMutationPort {
  save(ref: CredentialRef, value: string, provider?: PureLocalProviderId): Promise<CredentialMutationResult>;
  clear(ref: CredentialRef, provider?: PureLocalProviderId): Promise<CredentialMutationResult>;
}

export type CredentialState =
  | { status: "absent"; availability: CredentialAvailability }
  | { status: "stored"; availability: CredentialAvailability }
  | { status: "saving"; availability: CredentialAvailability }
  | { status: "clearing"; availability: CredentialAvailability }
  | { status: "success"; availability: CredentialAvailability }
  | { status: "error"; availability: CredentialAvailability; error: SafeCredentialError };

export type CredentialStateEvent =
  | { type: "synchronize"; availability: CredentialAvailability }
  | { type: "begin-save" }
  | { type: "begin-clear" }
  | { type: "mutation-complete"; result: CredentialMutationResult }
  | { type: "reset" };

export function isCredentialDomain(value: string): value is CredentialDomain {
  return value === "analysis" || value === "embeddings";
}

export function createCredentialRef(deviceId: string, domain: CredentialDomain): CredentialRef {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId || !isCredentialDomain(domain)) {
    throw new Error("Invalid credential reference.");
  }
  return { deviceId: normalizedDeviceId, domain };
}

export function getCredentialAvailability(
  ref: CredentialRef,
  provider: PureLocalProviderId,
  presence: PersistedCredentialPresence,
): CredentialAvailability {
  const required = shouldShowPureLocalApiKey(provider);
  if (!required) return { required: false, available: false };

  if (ref.domain === "analysis") {
    return { required, available: presence.analysisDevice };
  }

  const available = provider === "mistral"
    ? presence.embeddingsDevice || presence.analysisDevice || presence.legacyEmbedding || presence.legacyAi
    : presence.embeddingsDevice || presence.legacyEmbedding;
  return { required, available };
}

export function createCredentialState(availability: CredentialAvailability): CredentialState {
  return availability.available
    ? { status: "stored", availability: { ...availability } }
    : { status: "absent", availability: { ...availability } };
}

function isMutating(state: CredentialState): boolean {
  return state.status === "saving" || state.status === "clearing";
}

export function transitionCredentialState(state: CredentialState, event: CredentialStateEvent): CredentialState {
  if (event.type === "synchronize" || event.type === "reset") {
    return createCredentialState(event.type === "synchronize" ? event.availability : state.availability);
  }

  if (event.type === "begin-save" && !isMutating(state)) {
    return { status: "saving", availability: { ...state.availability } };
  }

  if (event.type === "begin-clear" && !isMutating(state)) {
    return { status: "clearing", availability: { ...state.availability } };
  }

  if (event.type === "mutation-complete" && isMutating(state)) {
    if (!event.result.ok) {
      return { status: "error", availability: { ...state.availability }, error: event.result.error };
    }
    return {
      status: "success",
      availability: { required: state.availability.required, available: event.result.available },
    };
  }

  return state;
}
