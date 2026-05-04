import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateNonce } from "@ave-id/sdk";
import { AveSession, completeExpoOAuthCallback, configureAveSdkForExpo, createSecureStoreAdapter, initExpoOAuthBrowserSession, onExpoAppForegroundRefresh, parseExpoOAuthRedirectUrl } from "@ave-id/sdk/expo-session";
import { normalizeAppKeyBase64 } from "@ave-id/sdk/app-key";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import * as Crypto from "expo-crypto";
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { AppState } from "react-native";

import { base64ToBytes, binaryToBase64, binaryToBytes, bytesToBase64 } from "@/lib/binary-encoding";
import { isProviderBackedPasskeyForItem } from "@/lib/native-credential-store";
import { normalizeSecureSyncUrl, secureSyncUrlError } from "@/lib/sync-transport";
import {
  isPlainMobileRecord,
  normalizeBootstrapResponse,
  normalizePullResponse,
  normalizePushBatchResponse,
  normalizeRemoteSyncStatus,
  normalizeWrappedVaultKey,
  syncKeyAlgorithm,
  syncKeyDerivation,
  syncSchemaVersion as schemaVersion,
  type EncryptedRecord,
  type PlainMobileRecord,
  type WrappedVaultKey,
} from "@/lib/sync-records";
import { normalizeMobilePasskey, normalizeVaultItem, type MobilePasskey, type MobileVaultItem, type MobileVaultState } from "@/lib/vault";

type SyncStatus = {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  deviceId: string;
  deviceName: string;
  accountName?: string;
  lastSyncAt?: string;
  lastError?: string;
  conflictCount: number;
  serverSequence: number;
};

type RemoteSyncStatus = {
  syncAllowed: boolean;
  sequence: number;
  schemaVersion: number;
  hasVaultKey: boolean;
};

type LocalRecordState = {
  kind?: PlainMobileRecord["kind"];
  itemId?: string;
  credentialId?: string;
  revision: number;
  contentHash: string;
  serverSequence: number;
  deletedAt?: number;
};

type RecordMetadata = Pick<LocalRecordState, "kind" | "itemId" | "credentialId">;

type PendingDeletedItemRecord = {
  kind: "item";
  recordId: string;
  itemId: string;
  itemType: MobileVaultItem["itemType"];
  itemName: string;
  deletedAt: number;
};

type PendingDeletedSitePasskeyRecord = {
  kind: "site-passkey";
  recordId: string;
  itemId: string;
  credentialId: string;
  deletedAt: number;
};

type PendingDeletedRecord = PendingDeletedItemRecord | PendingDeletedSitePasskeyRecord;

type LocalSyncState = {
  accountId?: string;
  deviceId: string;
  conflictCount: number;
  serverSequence: number;
  lastDeviceRegisteredAt: number;
  records: Record<string, LocalRecordState>;
  deletedRecords: Record<string, PendingDeletedRecord>;
};

type SyncRunOptions = {
  fullPull?: boolean;
};

type PendingOAuthRequest = {
  state: string;
  verifier: string;
  nonce: string;
  createdAt: number;
};

type MobileIdTokenClaims = {
  sub?: string;
  email?: string;
  name?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
};

type ValidMobileIdTokenClaims = MobileIdTokenClaims & {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
};

const syncLabel = "klarkey-sync-v1";
const sessionKey = "klarkey.ave.session.v1";
const pendingOAuthKey = "klarkey.ave.pending-oauth.v1";
const syncStateKey = "klarkey.mobile.sync-state.v1";
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const pendingOAuthMaxAgeMs = 10 * 60 * 1000;
const pendingOAuthFutureSkewMs = 60 * 1000;
const maxPendingOAuthBytes = 16 * 1024;
const maxSyncStateBytes = 256 * 1024;
const maxOAuthSecretLength = 4096;
const maxStateTextLength = 4096;
const deviceRegistrationIntervalMs = 1000 * 60 * 60 * 6;
const maxPushBatchRecords = 100;
const redirectUri = AuthSession.makeRedirectUri({ scheme: "klarkey", path: "oauth/callback" });
const clientId = process.env.EXPO_PUBLIC_KLARKEY_AVE_CLIENT_ID?.trim() || process.env.EXPO_PUBLIC_AVE_CLIENT_ID?.trim();
const rawConvexUrl = process.env.EXPO_PUBLIC_KLARKEY_CONVEX_URL?.trim() || process.env.EXPO_PUBLIC_CONVEX_URL?.trim();
const convexUrl = normalizeSecureSyncUrl(rawConvexUrl);
const oauth = clientId ? { clientId, redirectUri, issuer: "https://aveid.net" } : undefined;
const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i;
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i;
const syncFns = {
  bootstrapVault: makeFunctionReference<"mutation">("sync:bootstrapVault"),
  registerDevice: makeFunctionReference<"mutation">("sync:registerDevice"),
  getSyncStatus: makeFunctionReference<"query">("sync:getSyncStatus"),
  pullSince: makeFunctionReference<"query">("sync:pullSince"),
  pushBatch: makeFunctionReference<"mutation">("sync:pushBatch"),
};

function safeSyncErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (!message || message.length > 160 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback;
  }

  return message;
}

function requireConvexUrl() {
  if (!rawConvexUrl) {
    throw new Error("Set EXPO_PUBLIC_CONVEX_URL before using sync.");
  }
  if (!convexUrl) {
    throw new Error(secureSyncUrlError("EXPO_PUBLIC_CONVEX_URL"));
  }
  return convexUrl;
}

configureAveSdkForExpo(Crypto as unknown as Parameters<typeof configureAveSdkForExpo>[0]);
initExpoOAuthBrowserSession(WebBrowser);

const secureSessionStore = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key, secureStoreOptions),
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value, secureStoreOptions),
  deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key, secureStoreOptions),
};

const session = oauth
  ? new AveSession({
      oauth,
      storage: createSecureStoreAdapter(secureSessionStore, sessionKey),
      crossTabSync: false,
    })
  : undefined;

if (session) {
  onExpoAppForegroundRefresh(AppState, session);
}

let callbackCompletion: Promise<SyncStatus> | undefined;

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function sortValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      if (record[key] !== undefined) {
        result[key] = sortValue(record[key]);
      }
      return result;
    }, {});
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

async function digestBase64(value: string) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, textToBytes(value));
  return bytesToBase64(new Uint8Array(digest));
}

function recordHashPayload(record: PlainMobileRecord) {
  if ("updatedAt" in record) {
    const { updatedAt, ...payload } = record;
    void updatedAt;
    return payload;
  }
  return record;
}

async function recordHash(record: PlainMobileRecord) {
  return await digestBase64(canonicalJson(recordHashPayload(record)));
}

async function buildDirtyLocalRecordMap(records: PlainMobileRecord[], states: Record<string, LocalRecordState>) {
  const dirtyRecords = new Map<string, { record: PlainMobileRecord; contentHash: string }>();
  for (const record of records) {
    const contentHash = await recordHash(record);
    if (states[record.recordId]?.contentHash === contentHash) {
      continue;
    }
    dirtyRecords.set(record.recordId, { record, contentHash });
  }
  return dirtyRecords;
}

function recordMetadata(record: PlainMobileRecord): RecordMetadata {
  if (record.kind === "item") {
    return {
      kind: record.kind,
      itemId: record.itemId,
    };
  }

  if (record.kind === "site-passkey") {
    return {
      kind: record.kind,
      itemId: record.itemId,
      credentialId: record.credentialId,
    };
  }

  return {
    kind: record.kind,
  };
}

function syncStateFallback(accountId?: string, deviceId?: string): LocalSyncState {
  return {
    accountId,
    deviceId: deviceId ?? `device_${Crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
    conflictCount: 0,
    serverSequence: 0,
    lastDeviceRegisteredAt: 0,
    records: {},
    deletedRecords: {},
  };
}

function safeInteger(value: unknown, fallback: number, min = 0) {
  return Number.isSafeInteger(value) && (value as number) >= min ? value as number : fallback;
}

function safeStateText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" &&
    value.length <= maxStateTextLength &&
    (allowEmpty || value.trim().length > 0) &&
    !value.includes("\0");
}

function safeDeletedItemType(value: unknown): MobileVaultItem["itemType"] {
  return value === "login" || value === "note" || value === "card" || value === "identity" || value === "ssh-key" ? value : "login";
}

function normalizeRecordStates(value: unknown): Record<string, LocalRecordState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, LocalRecordState> = {};
  Object.entries(value as Record<string, Partial<LocalRecordState>>).forEach(([recordId, state]) => {
    if (!safeStateText(recordId) || !state || typeof state !== "object" || !safeStateText(state.contentHash, true)) {
      return;
    }
    const kind = state.kind === "item" || state.kind === "site-passkey" || state.kind === "settings" ? state.kind : undefined;
    result[recordId] = {
      kind,
      itemId: safeStateText(state.itemId) ? state.itemId : undefined,
      credentialId: safeStateText(state.credentialId) ? state.credentialId : undefined,
      revision: safeInteger(state.revision, 0),
      contentHash: state.contentHash,
      serverSequence: safeInteger(state.serverSequence, 0),
      deletedAt: safeInteger(state.deletedAt, 0, 1) || undefined,
    };
  });
  return result;
}

function normalizeDeletedRecords(value: unknown): Record<string, PendingDeletedRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, PendingDeletedRecord> = {};
  Object.entries(value as Record<string, Partial<PendingDeletedRecord>>).forEach(([recordId, record]) => {
    if (!safeStateText(recordId) || !record) {
      return;
    }
    const itemId = safeStateText(record.itemId) ? record.itemId : undefined;
    if (record.kind === "item" && itemId) {
      const itemRecord = record as Partial<PendingDeletedItemRecord>;
      const itemName = safeStateText(itemRecord.itemName, true) ? itemRecord.itemName : "Deleted item";
      result[recordId] = {
        kind: "item",
        recordId,
        itemId,
        itemType: safeDeletedItemType(itemRecord.itemType),
        itemName,
        deletedAt: safeInteger(record.deletedAt, Date.now(), 1),
      };
    }
    if (record.kind === "site-passkey") {
      const credentialId = safeStateText(record.credentialId)
        ? record.credentialId
        : recordId.slice("site-passkey:".length);
      if (!safeStateText(credentialId)) {
        return;
      }
      result[recordId] = {
        kind: "site-passkey",
        recordId: `site-passkey:${credentialId}`,
        itemId: itemId ?? "deleted",
        credentialId,
        deletedAt: safeInteger(record.deletedAt, Date.now(), 1),
      };
    }
  });
  return result;
}

function normalizeSyncState(value: unknown): LocalSyncState {
  if (!value || typeof value !== "object") {
    return syncStateFallback();
  }

  const stored = value as Partial<LocalSyncState>;
  const fallback = syncStateFallback();
  return {
    accountId: safeStateText(stored.accountId) ? stored.accountId : undefined,
    deviceId: safeStateText(stored.deviceId) ? stored.deviceId : fallback.deviceId,
    conflictCount: safeInteger(stored.conflictCount, 0),
    serverSequence: safeInteger(stored.serverSequence, 0),
    lastDeviceRegisteredAt: safeInteger(stored.lastDeviceRegisteredAt, 0),
    records: normalizeRecordStates(stored.records),
    deletedRecords: normalizeDeletedRecords(stored.deletedRecords),
  };
}

async function resetSyncStateForAccount(state: LocalSyncState, identityId: string) {
  if (state.accountId === identityId) {
    return state;
  }

  await SecureStore.deleteItemAsync(`${syncStateKey}.lastSyncAt`, secureStoreOptions).catch(() => undefined);
  await SecureStore.deleteItemAsync(`${syncStateKey}.lastError`, secureStoreOptions).catch(() => undefined);
  return syncStateFallback(identityId, state.deviceId);
}

function parseBoundedJson(value: string, maxBytes: number) {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error("Stored Klarkey sync state is too large.");
  }

  return JSON.parse(value) as unknown;
}

async function readSyncState() {
  const stored = await SecureStore.getItemAsync(syncStateKey, secureStoreOptions);
  if (!stored) {
    const next = syncStateFallback();
    await writeSyncState(next);
    return next;
  }

  try {
    const next = normalizeSyncState(parseBoundedJson(stored, maxSyncStateBytes));
    await writeSyncState(next);
    return next;
  } catch {
    const next = syncStateFallback();
    await writeSyncState(next);
    return next;
  }
}

async function writeSyncState(state: LocalSyncState) {
  await SecureStore.setItemAsync(syncStateKey, JSON.stringify(state), secureStoreOptions);
}

function isSafeOAuthSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxOAuthSecretLength && !value.includes("\0");
}

function normalizePendingOAuthRequest(value: unknown): PendingOAuthRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const request = value as Partial<PendingOAuthRequest>;
  const { state, verifier, nonce, createdAt } = request;
  if (!isSafeOAuthSecret(state) || !isSafeOAuthSecret(verifier) || !isSafeOAuthSecret(nonce) || !isFreshPendingOAuthTimestamp(createdAt)) {
    return undefined;
  }

  return {
    state,
    verifier,
    nonce,
    createdAt,
  };
}

async function readPendingOAuthRequest() {
  const stored = await SecureStore.getItemAsync(pendingOAuthKey, secureStoreOptions);
  if (!stored) {
    return undefined;
  }

  try {
    const pending = normalizePendingOAuthRequest(parseBoundedJson(stored, maxPendingOAuthBytes));
    if (!pending) {
      await SecureStore.deleteItemAsync(pendingOAuthKey, secureStoreOptions).catch(() => undefined);
    }
    return pending;
  } catch {
    await SecureStore.deleteItemAsync(pendingOAuthKey, secureStoreOptions).catch(() => undefined);
    return undefined;
  }
}

async function writePendingOAuthRequest(request: PendingOAuthRequest) {
  await SecureStore.setItemAsync(pendingOAuthKey, JSON.stringify(request), secureStoreOptions);
}

async function clearPendingOAuthRequest() {
  await SecureStore.deleteItemAsync(pendingOAuthKey, secureStoreOptions).catch(() => undefined);
}

function client(idToken: string) {
  return new ConvexHttpClient(requireConvexUrl(), { auth: idToken });
}

export async function watchMobileSyncStatus(onUpdate: (status: RemoteSyncStatus) => void, onError: (error: Error) => void) {
  if (!session || !convexUrl) {
    return () => undefined;
  }

  await session.hydrate();
  if (session.getState().status !== "signedIn") {
    return () => undefined;
  }

  const realtime = new ConvexClient(convexUrl);
  realtime.setAuth(async () => {
    try {
      await session.hydrate();
      const idToken = await session.getValidIdToken();
      validateMobileIdToken(idToken);
      return idToken;
    } catch {
      return null;
    }
  });

  const unsubscribe = realtime.onUpdate(syncFns.getSyncStatus, {}, (remote) => {
    try {
      onUpdate(normalizeRemoteSyncStatus(remote));
    } catch (error) {
      onError(error instanceof Error ? error : new Error("Invalid Klarkey sync status response."));
    }
  }, onError);
  return () => {
    unsubscribe();
    void realtime.close();
  };
}

async function deriveSyncKek(appKey: string) {
  const normalized = normalizeAppKeyBase64(appKey);
  if (!normalized) {
    throw new Error("Ave did not return an E2EE app key.");
  }
  return hkdf(sha256, base64ToBytes(normalized), new Uint8Array(), textToBytes(syncLabel), 32);
}

async function aesKey(bytes: Uint8Array) {
  return AESEncryptionKey.import(bytes);
}

function sealedFromBase64Parts(parts: { iv: string; ciphertext: string; authTag: string }) {
  return AESSealedData.fromParts(
    binaryToBytes(parts.iv),
    binaryToBytes(parts.ciphertext),
    binaryToBytes(parts.authTag),
  );
}

function aad(identityId: string, recordId: string, revision: number, version = schemaVersion) {
  return textToBytes(canonicalJson({ identityId, recordId, revision, schemaVersion: version }));
}

async function wrapVaultKey(appKey: string, vaultKey: Uint8Array) {
  const sealed = await aesEncryptAsync(vaultKey, await aesKey(await deriveSyncKek(appKey)));
  return {
    iv: binaryToBase64(await sealed.iv("base64")),
    ciphertext: binaryToBase64(await sealed.ciphertext({ encoding: "base64" })),
    authTag: binaryToBase64(await sealed.tag("base64")),
    algorithm: syncKeyAlgorithm,
    derivation: syncKeyDerivation,
    wrappedAt: Date.now(),
  };
}

async function unwrapVaultKey(appKey: string, wrapped: WrappedVaultKey) {
  const envelope = normalizeWrappedVaultKey(wrapped);
  if (envelope.algorithm !== syncKeyAlgorithm || envelope.derivation !== syncKeyDerivation) {
    throw new Error("Unsupported Klarkey sync key envelope.");
  }

  const sealed = sealedFromBase64Parts(envelope);
  const decrypted = await aesDecryptAsync(sealed, await aesKey(await deriveSyncKek(appKey)));
  const vaultKey = decrypted as Uint8Array;
  if (vaultKey.length !== 32) {
    throw new Error("Invalid Klarkey sync vault key.");
  }
  return vaultKey;
}

async function encryptRecord(vaultKey: Uint8Array, identityId: string, deviceId: string, revision: number, record: PlainMobileRecord) {
  const contentHash = await recordHash(record);
  const sealed = await aesEncryptAsync(textToBytes(canonicalJson(record)), await aesKey(vaultKey), {
    additionalData: aad(identityId, record.recordId, revision),
  });
  return {
    recordId: record.recordId,
    revision,
    deviceId,
    deletedAt: record.deletedAt,
    ciphertext: binaryToBase64(await sealed.ciphertext({ encoding: "base64" })),
    iv: binaryToBase64(await sealed.iv("base64")),
    authTag: binaryToBase64(await sealed.tag("base64")),
    contentHash,
    schemaVersion,
  };
}

async function decryptRecord(vaultKey: Uint8Array, identityId: string, record: EncryptedRecord): Promise<PlainMobileRecord> {
  const sealed = sealedFromBase64Parts(record);
  const decrypted = await aesDecryptAsync(sealed, await aesKey(vaultKey), {
    additionalData: aad(identityId, record.recordId, record.revision, record.schemaVersion),
  });
  const plain = JSON.parse(bytesToText(decrypted as Uint8Array)) as unknown;
  if (!isPlainMobileRecord(plain)) {
    throw new Error("Invalid Klarkey sync record payload.");
  }
  if (plain.recordId !== record.recordId || plain.deletedAt !== record.deletedAt) {
    throw new Error("Klarkey sync record metadata mismatch.");
  }
  if (await recordHash(plain) !== record.contentHash) {
    throw new Error("Klarkey sync record hash mismatch.");
  }
  return plain;
}

function isDeviceLocalPasskeyItemId(itemId: string) {
  return itemId.startsWith("passkey:");
}

function isDeviceLocalPasskeyItemRecord(record: PlainMobileRecord) {
  return record.kind === "item" && isDeviceLocalPasskeyItemId(record.itemId);
}

function isDeviceLocalPasskeyItem(item: MobileVaultItem) {
  return isDeviceLocalPasskeyItemId(item.id);
}

function isSyncablePasskey(passkey: MobilePasskey) {
  return Boolean(
    !passkey.providerBacked &&
    passkey.privateKeyJwk &&
    passkey.itemId &&
    !isDeviceLocalPasskeyItemId(passkey.itemId) &&
    passkey.id &&
    passkey.rpId,
  );
}

function plainRecords(vault: MobileVaultState): PlainMobileRecord[] {
  const itemRecords = vault.items
    .filter((item) => !isDeviceLocalPasskeyItem(item))
    .map((item) => ({
      kind: "item",
      recordId: `item:${item.id}`,
      itemId: item.id,
      itemType: item.itemType,
      item: mobileItemToSyncInput(item),
      updatedAt: item.updatedAt ?? item.createdAt ?? item.id,
    } satisfies PlainMobileRecord));
  const passkeyRecords = vault.passkeys
    .filter(isSyncablePasskey)
    .map((passkey) => ({
      kind: "site-passkey",
      recordId: `site-passkey:${passkey.id}`,
      passkeyId: passkey.id,
      itemId: passkey.itemId ?? "",
      credentialId: passkey.id,
      label: passkey.username || passkey.rpId,
      rpId: passkey.rpId,
      userName: passkey.username,
      userHandle: passkey.userHandle,
      transports: passkey.transports ?? ["internal"],
      privateKeyJwk: passkey.privateKeyJwk,
      signCount: 0,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
      syncedCounter: true,
    } satisfies PlainMobileRecord));

  return [...itemRecords, ...passkeyRecords];
}

function mobileItemToSyncInput(item: MobileVaultItem) {
  return {
    itemId: item.id,
    itemType: item.itemType,
    itemName: item.itemName,
    username: item.username ?? "",
    password: item.password,
    otp: item.otpCode ?? item.otp,
    fullName: item.fullName,
    firstName: item.firstName,
    middleName: item.middleName,
    lastName: item.lastName,
    company: item.company,
    jobTitle: item.jobTitle,
    birthDate: item.birthDate,
    email: item.email,
    phone: item.phone,
    addressLine1: item.addressLine1,
    addressLine2: item.addressLine2,
    city: item.city,
    state: item.state,
    postalCode: item.postalCode,
    country: item.country,
    cardholderName: item.cardholderName,
    cardNumber: item.cardNumber,
    cardExpiryMonth: item.cardExpiryMonth,
    cardExpiryYear: item.cardExpiryYear,
    cardCvc: item.cardCvc,
    cardBrand: item.cardBrand,
    billingPostalCode: item.billingPostalCode,
    sshPublicKey: item.sshPublicKey,
    sshPrivateKey: item.sshPrivateKey,
    sshComment: item.sshComment,
    sshAlgorithm: item.sshAlgorithm,
    sshFingerprint: item.sshFingerprint,
    content: item.content,
    notes: item.notes,
    websites: item.websites,
    customFields: item.customFields,
    recoveryCodes: item.recoveryCodes ?? [],
    ssoProvider: item.ssoProvider,
  };
}

function applyPlainRecord(vault: MobileVaultState, record: PlainMobileRecord) {
  if (record.deletedAt !== undefined) {
    return applyDeletedPlainRecord(vault, record);
  }

  if (record.kind === "item") {
    if (isDeviceLocalPasskeyItemRecord(record)) {
      return vault;
    }
    const { itemId, ...syncedItem } = record.item;
    void itemId;
    const item = normalizeVaultItem({
      ...syncedItem,
      id: record.itemId,
      itemType: record.itemType,
      kind: record.itemType,
      updatedAt: record.updatedAt,
    });
    const linkedItem = {
      ...item,
      hasPasskey: item.itemType === "login" ? vault.passkeys.some((passkey) => passkeyBelongsToItem(passkey, item.id, item)) : item.hasPasskey,
    };
    return {
      ...vault,
      items: vault.items.some((candidate) => candidate.id === record.itemId)
        ? vault.items.map((candidate) => (candidate.id === record.itemId ? linkedItem : candidate))
        : [linkedItem, ...vault.items],
    };
  }

  if (record.kind === "settings") {
    return vault;
  }

  if (!record.credentialId && !record.passkeyId) {
    return vault;
  }

  const passkey = normalizeMobilePasskey({
    id: record.credentialId || record.passkeyId,
    rpId: record.rpId ?? "",
    username: record.userName ?? record.label,
    userHandle: record.userHandle,
    transports: record.transports,
    privateKeyJwk: record.privateKeyJwk,
    signCount: 0,
    itemId: record.itemId,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    syncedCounter: true,
    providerBacked: false,
  });
  return {
    ...vault,
    passkeys: vault.passkeys.some((candidate) => candidate.id === passkey.id)
      ? vault.passkeys.map((candidate) => (candidate.id === passkey.id ? passkey : candidate))
      : [passkey, ...vault.passkeys],
    items: vault.items.map((item) => (item.id === record.itemId ? { ...item, hasPasskey: true } : item)),
  };
}

function applyDeletedPlainRecord(vault: MobileVaultState, record: PlainMobileRecord) {
  if (record.kind === "item") {
    const deletedItem = vault.items.find((item) => item.id === record.itemId);
    return {
      ...vault,
      items: vault.items.filter((item) => item.id !== record.itemId),
      passkeys: vault.passkeys.filter((passkey) => !passkeyBelongsToItem(passkey, record.itemId, deletedItem)),
    };
  }

  if (record.kind === "settings") {
    return vault;
  }

  const passkeys = vault.passkeys.filter((passkey) => passkey.id !== record.credentialId && passkey.id !== record.passkeyId);
  return {
    ...vault,
    passkeys,
    items: vault.items.map((item) => (
      item.id === record.itemId
        ? { ...item, hasPasskey: passkeys.some((passkey) => passkey.itemId === item.id) }
        : item
    )),
  };
}

function passkeyBelongsToItem(passkey: MobilePasskey, itemId: string, item?: MobileVaultItem) {
  return passkey.itemId === itemId || Boolean(item && isProviderBackedPasskeyForItem(passkey, item));
}

function preserveConflictCopy(vault: MobileVaultState, record: PlainMobileRecord) {
  if (record.kind !== "item" || record.deletedAt !== undefined) {
    return vault;
  }

  const timestamp = new Date().toISOString();
  const itemName = `${record.item.itemName} conflict`;
  const copy = normalizeVaultItem({
    ...record.item,
    id: Crypto.randomUUID(),
    itemType: record.itemType,
    kind: record.itemType,
    itemName,
    title: itemName,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return {
    ...vault,
    items: [copy, ...vault.items],
  };
}

function deletedRecordToPlainRecord(record: PendingDeletedRecord): PlainMobileRecord {
  if (record.kind === "site-passkey") {
    return {
      kind: "site-passkey",
      recordId: record.recordId,
      passkeyId: record.credentialId,
      itemId: record.itemId,
      credentialId: record.credentialId,
      label: "Deleted passkey",
      transports: [],
      signCount: 0,
      createdAt: new Date(record.deletedAt).toISOString(),
      syncedCounter: true,
      deletedAt: record.deletedAt,
    };
  }

  return {
    kind: "item",
    recordId: record.recordId,
    itemId: record.itemId,
    itemType: record.itemType,
    item: {
      itemId: record.itemId,
      itemType: record.itemType,
      itemName: record.itemName,
    },
    updatedAt: new Date(record.deletedAt).toISOString(),
    deletedAt: record.deletedAt,
  };
}

function addMissingDeletedRecords(state: LocalSyncState, activeRecordIds: Set<string>) {
  const deletedAt = Date.now();
  Object.entries(state.records).forEach(([recordId, record]) => {
    if (activeRecordIds.has(recordId) || record.deletedAt !== undefined || state.deletedRecords[recordId]) {
      return;
    }
    if (record.kind === "item" || (!record.kind && recordId.startsWith("item:"))) {
      const itemId = record.itemId ?? recordId.slice("item:".length);
      if (!itemId) {
        return;
      }
      state.deletedRecords[recordId] = {
        kind: "item",
        recordId,
        itemId,
        itemType: "login",
        itemName: "Deleted item",
        deletedAt,
      };
    }
    if (record.kind === "site-passkey" || (!record.kind && recordId.startsWith("site-passkey:"))) {
      const credentialId = record.credentialId ?? recordId.slice("site-passkey:".length);
      if (!credentialId) {
        return;
      }
      state.deletedRecords[recordId] = {
        kind: "site-passkey",
        recordId: `site-passkey:${credentialId}`,
        itemId: record.itemId ?? "deleted",
        credentialId,
        deletedAt,
      };
    }
  });
}

function decodeJwtPayload(idToken: string) {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) {
      return undefined;
    }
    return JSON.parse(bytesToText(base64ToBytes(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")))) as MobileIdTokenClaims;
  } catch {
    return undefined;
  }
}

function normalizedIssuer(value: string) {
  return value.replace(/\/+$/, "");
}

function audienceMatches(audience: string | string[] | undefined, expectedClientId: string) {
  return Array.isArray(audience) ? audience.includes(expectedClientId) : audience === expectedClientId;
}

function validateMobileIdToken(idToken: string | null | undefined, expectedNonce?: string): ValidMobileIdTokenClaims {
  const claims = idToken ? decodeJwtPayload(idToken) : undefined;
  if (!oauth || !claims?.sub || !claims.iss || !claims.aud || !claims.exp) {
    throw new Error("Ave did not return a valid identity token.");
  }
  if (normalizedIssuer(claims.iss) !== normalizedIssuer(oauth.issuer)) {
    throw new Error("Ave identity token issuer did not match this Klarkey session.");
  }
  if (!audienceMatches(claims.aud, oauth.clientId)) {
    throw new Error("Ave identity token audience did not match this Klarkey app.");
  }
  if (claims.exp * 1000 <= Date.now()) {
    throw new Error("Ave identity token is expired.");
  }
  if (expectedNonce !== undefined && claims.nonce !== expectedNonce) {
    throw new Error("Ave sign-in nonce did not match this Klarkey session.");
  }
  return claims as ValidMobileIdTokenClaims;
}

function isFreshPendingOAuthTimestamp(createdAt: unknown, now = Date.now()): createdAt is number {
  return (
    typeof createdAt === "number" &&
    Number.isFinite(createdAt) &&
    createdAt > 0 &&
    createdAt <= now + pendingOAuthFutureSkewMs &&
    now - createdAt <= pendingOAuthMaxAgeMs
  );
}

async function getValidatedSessionToken() {
  if (!session) {
    throw new Error("Sync is not configured.");
  }

  await session.hydrate();
  const idToken = await session.getValidIdToken();
  const appKey = session.getAppKeyBase64();
  if (!idToken || !appKey) {
    throw new Error("Sign in with Ave before syncing.");
  }
  const claims = validateMobileIdToken(idToken);
  return { idToken, appKey, identityId: claims.sub };
}

function sessionAccountName() {
  const snapshot = session?.getState().snapshot;
  if (!snapshot?.id_token) {
    return undefined;
  }
  const parsed = decodeJwtPayload(snapshot.id_token);
  return parsed?.email ?? parsed?.name;
}

export async function getMobileSyncStatus(): Promise<SyncStatus> {
  let state = await readSyncState();
  let sessionError: string | undefined;
  if (session) {
    try {
      await session.hydrate();
      const accountId = decodeJwtPayload(session.getState().snapshot?.id_token ?? "")?.sub;
      if (accountId) {
        state = await resetSyncStateForAccount(state, accountId);
        await writeSyncState(state);
      }
    } catch (error) {
      sessionError = safeSyncErrorMessage(error, "Sync session could not be loaded.");
    }
  }
  const transportError = rawConvexUrl && !convexUrl ? secureSyncUrlError("EXPO_PUBLIC_CONVEX_URL") : undefined;
  return {
    configured: Boolean(oauth && convexUrl),
    signedIn: session?.getState().status === "signedIn",
    syncing: false,
    deviceId: state.deviceId,
    deviceName: "Mobile",
    accountName: sessionAccountName(),
    lastSyncAt: await SecureStore.getItemAsync(`${syncStateKey}.lastSyncAt`, secureStoreOptions) ?? undefined,
    lastError: sessionError ?? transportError ?? await SecureStore.getItemAsync(`${syncStateKey}.lastError`, secureStoreOptions) ?? undefined,
    conflictCount: state.conflictCount,
    serverSequence: state.serverSequence,
  };
}

export async function signInMobileSync() {
  if (!oauth || !session) {
    throw new Error("Set EXPO_PUBLIC_AVE_CLIENT_ID before using sync.");
  }
  requireConvexUrl();

  const verifier = generateCodeVerifier();
  const state = Crypto.randomUUID();
  const nonce = generateNonce();
  const codeChallenge = await generateCodeChallenge(verifier);
  await writePendingOAuthRequest({
    state,
    verifier,
    nonce,
    createdAt: Date.now(),
  });

  const authUrl = buildAuthorizeUrl(oauth, {
    scope: ["openid", "profile", "email", "offline_access"],
    state,
    nonce,
    codeChallenge,
    codeChallengeMethod: "S256",
  });
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
  if (result.type !== "success" || !("url" in result)) {
    const status = await getMobileSyncStatus();
    if (!status.signedIn) {
      await clearPendingOAuthRequest();
    }
    return status;
  }

  return await completeMobileSyncCallback(result.url);
}

async function finishMobileSyncCallback(callbackUrl: string) {
  if (!oauth || !session) {
    throw new Error("Sync is not configured.");
  }

  const parsed = parseExpoOAuthRedirectUrl(callbackUrl);
  if (!parsed.code) {
    throw new Error("Ave did not return an authorization code.");
  }

  const pending = await readPendingOAuthRequest();
  if (!pending) {
    const status = await getMobileSyncStatus();
    if (status.signedIn) {
      return status;
    }
    throw new Error("Sync sign-in expired. Start again from Settings.");
  }
  if (!isFreshPendingOAuthTimestamp(pending.createdAt)) {
    await clearPendingOAuthRequest();
    throw new Error("Sync sign-in expired. Start again from Settings.");
  }

  const tokens = await completeExpoOAuthCallback(session, oauth, {
    code: parsed.code,
    codeVerifier: pending.verifier,
    expectedState: pending.state,
    responseState: parsed.state ?? undefined,
    redirectUrlWithFragment: parsed.urlForAppKeyMerge,
  });
  try {
    validateMobileIdToken(tokens.id_token, pending.nonce);
  } catch (error) {
    await clearPendingOAuthRequest();
    await session.signOut().catch(() => undefined);
    throw error;
  }
  await clearPendingOAuthRequest();
  return await getMobileSyncStatus();
}

export async function completeMobileSyncCallback(callbackUrl: string) {
  callbackCompletion ??= finishMobileSyncCallback(callbackUrl).finally(() => {
    callbackCompletion = undefined;
  });
  return await callbackCompletion;
}

export async function signOutMobileSync() {
  await clearPendingOAuthRequest();
  await session?.signOut();
  return await getMobileSyncStatus();
}

export async function queueMobileSyncDeletedItem(item: MobileVaultItem) {
  const state = await readSyncState();
  const recordId = `item:${item.id}`;
  if (!state.records[recordId]) {
    return;
  }
  state.deletedRecords[recordId] = {
    kind: "item",
    recordId,
    itemId: item.id,
    itemType: item.itemType,
    itemName: item.itemName,
    deletedAt: Date.now(),
  };
  await writeSyncState(state);
}

function shouldFullPull(state: LocalSyncState, options: SyncRunOptions) {
  if (options.fullPull) {
    return true;
  }
  return state.serverSequence > 0 && Object.keys(state.records).length === 0;
}

export async function syncMobileVault(vault: MobileVaultState, options: SyncRunOptions = {}): Promise<{ status: SyncStatus; vault: MobileVaultState; pulledCount: number; pushedCount: number; repairedCursor: boolean }> {
  if (!session) {
    throw new Error("Sync is not configured.");
  }

  const { idToken, appKey, identityId } = await getValidatedSessionToken();

  let state = await readSyncState();
  state = await resetSyncStateForAccount(state, identityId);
  state.conflictCount = 0;
  const remote = client(idToken);
  if (Date.now() - (state.lastDeviceRegisteredAt ?? 0) > deviceRegistrationIntervalMs) {
    await remote.mutation(syncFns.registerDevice, {
      deviceId: state.deviceId,
      name: "Mobile",
      platform: "mobile",
    });
    state.lastDeviceRegisteredAt = Date.now();
  }

  const repairCursor = shouldFullPull(state, options);
  const since = repairCursor ? 0 : state.serverSequence;
  const pull = normalizePullResponse(await remote.query(syncFns.pullSince, {
    since,
    limit: 500,
  }));
  const dirtyLocalRecords = await buildDirtyLocalRecordMap(plainRecords(vault), state.records);
  let vaultKey = pull.wrappedVaultKey
    ? await unwrapVaultKey(appKey, pull.wrappedVaultKey)
    : Crypto.getRandomBytes(32);
  try {
    if (!pull.wrappedVaultKey) {
      const setup = normalizeBootstrapResponse(await remote.mutation(syncFns.bootstrapVault, {
        schemaVersion,
        wrappedVaultKey: await wrapVaultKey(appKey, vaultKey),
      }));
      if (setup.wrappedVaultKey) {
        vaultKey = await unwrapVaultKey(appKey, setup.wrappedVaultKey);
      }
    }
    let nextVault = vault;
    let decryptFailures = 0;
    let appliedRecords = 0;
    for (const record of pull.records) {
      const current = state.records[record.recordId];
      const dirtyLocalRecord = dirtyLocalRecords.get(record.recordId);
      if (current?.contentHash === record.contentHash) {
        if (!dirtyLocalRecord && record.deletedAt !== undefined) {
          try {
            nextVault = applyPlainRecord(nextVault, await decryptRecord(vaultKey, identityId, record));
            appliedRecords += 1;
          } catch {
            decryptFailures += 1;
          }
        }
        state.records[record.recordId] = {
          kind: current.kind,
          itemId: current.itemId,
          credentialId: current.credentialId,
          revision: Math.max(current.revision, record.revision),
          contentHash: record.contentHash,
          serverSequence: record.serverSequence,
          deletedAt: record.deletedAt,
        };
        if (record.deletedAt !== undefined) {
          delete state.deletedRecords[record.recordId];
        }
        state.serverSequence = Math.max(state.serverSequence, record.serverSequence);
        continue;
      }

      let plain: PlainMobileRecord;
      try {
        plain = await decryptRecord(vaultKey, identityId, record);
      } catch {
        decryptFailures += 1;
        state.records[record.recordId] = {
          kind: current?.kind,
          itemId: current?.itemId,
          credentialId: current?.credentialId,
          revision: record.revision,
          contentHash: "",
          serverSequence: record.serverSequence,
          deletedAt: record.deletedAt,
        };
        state.serverSequence = Math.max(state.serverSequence, record.serverSequence);
        continue;
      }
      if (current?.contentHash && dirtyLocalRecord && dirtyLocalRecord.contentHash !== record.contentHash) {
        nextVault = preserveConflictCopy(nextVault, dirtyLocalRecord.record);
        state.conflictCount += 1;
      }
      nextVault = applyPlainRecord(nextVault, plain);
      appliedRecords += 1;
      const metadata = recordMetadata(plain);
      state.records[record.recordId] = {
        kind: metadata.kind,
        itemId: metadata.itemId,
        credentialId: metadata.credentialId,
        revision: record.revision,
        contentHash: record.contentHash,
        serverSequence: record.serverSequence,
        deletedAt: record.deletedAt,
      };
      if (record.deletedAt !== undefined) {
        delete state.deletedRecords[record.recordId];
      }
      state.serverSequence = Math.max(state.serverSequence, record.serverSequence);
    }

    const recordsToPush = [];
    const activeRecords = plainRecords(nextVault);
    const activeRecordIds = new Set(activeRecords.map((record) => record.recordId));
    addMissingDeletedRecords(state, activeRecordIds);
    const plainRecordsToPush = [
      ...activeRecords,
      ...Object.values(state.deletedRecords).map(deletedRecordToPlainRecord),
    ];
    const plainById = new Map<string, PlainMobileRecord>();
    const encryptedById = new Map<string, Awaited<ReturnType<typeof encryptRecord>>>();

    for (const record of plainRecordsToPush) {
      const hash = await recordHash(record);
      const current = state.records[record.recordId];
      const metadata = recordMetadata(record);
      if (current?.contentHash === hash) {
        if (current.kind !== metadata.kind || current.itemId !== metadata.itemId || current.credentialId !== metadata.credentialId) {
          state.records[record.recordId] = {
            ...current,
            ...metadata,
            contentHash: hash,
          };
        }
        if (record.deletedAt !== undefined) {
          delete state.deletedRecords[record.recordId];
        }
        continue;
      }
      const revision = (current?.revision ?? 0) + 1;
      const encrypted = await encryptRecord(vaultKey, identityId, state.deviceId, revision, record);
      recordsToPush.push(encrypted);
      plainById.set(record.recordId, record);
      encryptedById.set(record.recordId, encrypted);
    }

    if (recordsToPush.length > 0) {
      for (let offset = 0; offset < recordsToPush.length; offset += maxPushBatchRecords) {
        const pushed = normalizePushBatchResponse(await remote.mutation(syncFns.pushBatch, { records: recordsToPush.slice(offset, offset + maxPushBatchRecords) }));
        pushed.accepted.forEach((record) => {
          const encrypted = encryptedById.get(record.recordId);
          const plain = plainById.get(record.recordId);
          const metadata = plain ? recordMetadata(plain) : state.records[record.recordId];
          state.records[record.recordId] = {
            kind: metadata?.kind,
            itemId: metadata?.itemId,
            credentialId: metadata?.credentialId,
            revision: record.revision,
            contentHash: record.contentHash,
            serverSequence: record.serverSequence,
            deletedAt: encrypted?.deletedAt,
          };
          if (encrypted?.deletedAt !== undefined) {
            delete state.deletedRecords[record.recordId];
          }
        });
        for (const conflict of pushed.conflicts) {
          const local = plainById.get(conflict.recordId);
          if (local) {
            nextVault = preserveConflictCopy(nextVault, local);
          }
          try {
            const plain = await decryptRecord(vaultKey, identityId, conflict);
            nextVault = applyPlainRecord(nextVault, plain);
            const metadata = recordMetadata(plain);
            state.records[conflict.recordId] = {
              kind: metadata.kind,
              itemId: metadata.itemId,
              credentialId: metadata.credentialId,
              revision: conflict.revision,
              contentHash: conflict.contentHash,
              serverSequence: conflict.serverSequence,
              deletedAt: conflict.deletedAt,
            };
          } catch {
            decryptFailures += 1;
            const current = state.records[conflict.recordId];
            state.records[conflict.recordId] = {
              kind: current?.kind,
              itemId: current?.itemId,
              credentialId: current?.credentialId,
              revision: conflict.revision,
              contentHash: "",
              serverSequence: conflict.serverSequence,
              deletedAt: conflict.deletedAt,
            };
          }
          delete state.deletedRecords[conflict.recordId];
          state.serverSequence = Math.max(state.serverSequence, conflict.serverSequence);
        }
        state.conflictCount += pushed.conflicts.length;
        state.serverSequence = Math.max(state.serverSequence, pushed.sequence);
      }
    }

    await writeSyncState(state);
    await SecureStore.setItemAsync(`${syncStateKey}.lastSyncAt`, new Date().toISOString(), secureStoreOptions);
    if (decryptFailures > 0) {
      await SecureStore.setItemAsync(`${syncStateKey}.lastError`, `${decryptFailures} sync record${decryptFailures === 1 ? "" : "s"} need repair from another device.`, secureStoreOptions);
    } else {
      await SecureStore.deleteItemAsync(`${syncStateKey}.lastError`, secureStoreOptions).catch(() => undefined);
    }
    return {
      status: await getMobileSyncStatus(),
      vault: nextVault,
      pulledCount: appliedRecords,
      pushedCount: recordsToPush.length,
      repairedCursor: repairCursor,
    };
  } finally {
    vaultKey.fill(0);
  }
}

export type { SyncStatus };
