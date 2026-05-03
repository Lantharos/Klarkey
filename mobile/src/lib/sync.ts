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

type PlainMobileRecord =
  | {
      kind: "item";
      recordId: string;
      itemId: string;
      itemType: MobileVaultItem["itemType"];
      item: Partial<MobileVaultItem> & { itemId: string; itemType: MobileVaultItem["itemType"]; itemName: string; username?: string };
      updatedAt: string;
      deletedAt?: number;
    }
  | {
      kind: "site-passkey";
      recordId: string;
      passkeyId: string;
      itemId: string;
      credentialId: string;
      label: string;
      rpId?: string;
      userName?: string;
      userHandle?: string;
      transports: string[];
      privateKeyJwk?: JsonWebKey;
      signCount: number;
      createdAt: string;
      lastUsedAt?: string;
      syncedCounter: true;
      deletedAt?: number;
    }
  | {
      kind: "settings";
      recordId: "settings:user";
      settings: Record<string, unknown>;
      updatedAt: string;
      deletedAt?: number;
    };

type EncryptedRecord = {
  recordId: string;
  revision: number;
  serverSequence: number;
  deviceId: string;
  deletedAt?: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  contentHash: string;
  schemaVersion: number;
};

type PushAccepted = {
  recordId: string;
  revision: number;
  serverSequence: number;
  contentHash: string;
};

type RemoteSyncStatus = {
  syncAllowed: boolean;
  sequence: number;
  schemaVersion: number;
  hasVaultKey: boolean;
};

type LocalRecordState = {
  revision: number;
  contentHash: string;
  serverSequence: number;
  deletedAt?: number;
};

type PendingDeletedRecord = {
  kind: "item";
  recordId: string;
  itemId: string;
  itemType: MobileVaultItem["itemType"];
  itemName: string;
  deletedAt: number;
};

type LocalSyncState = {
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
  createdAt: number;
};

const schemaVersion = 1;
const syncLabel = "klarkey-sync-v1";
const sessionKey = "klarkey.ave.session.v1";
const pendingOAuthKey = "klarkey.ave.pending-oauth.v1";
const syncStateKey = "klarkey.mobile.sync-state.v1";
const deviceRegistrationIntervalMs = 1000 * 60 * 60 * 6;
const redirectUri = AuthSession.makeRedirectUri({ scheme: "klarkey", path: "oauth/callback" });
const clientId = process.env.EXPO_PUBLIC_KLARKEY_AVE_CLIENT_ID?.trim() || process.env.EXPO_PUBLIC_AVE_CLIENT_ID?.trim();
const convexUrl = process.env.EXPO_PUBLIC_KLARKEY_CONVEX_URL?.trim() || process.env.EXPO_PUBLIC_CONVEX_URL?.trim();
const oauth = clientId ? { clientId, redirectUri, issuer: "https://aveid.net" } : undefined;
const syncFns = {
  bootstrapVault: makeFunctionReference<"mutation">("sync:bootstrapVault"),
  registerDevice: makeFunctionReference<"mutation">("sync:registerDevice"),
  getSyncStatus: makeFunctionReference<"query">("sync:getSyncStatus"),
  pullSince: makeFunctionReference<"query">("sync:pullSince"),
  pushBatch: makeFunctionReference<"mutation">("sync:pushBatch"),
};

configureAveSdkForExpo(Crypto as unknown as Parameters<typeof configureAveSdkForExpo>[0]);
initExpoOAuthBrowserSession(WebBrowser);

const session = oauth
  ? new AveSession({
      oauth,
      storage: createSecureStoreAdapter(SecureStore, sessionKey),
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

function syncStateFallback(): LocalSyncState {
  return {
    deviceId: `device_${Crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
    conflictCount: 0,
    serverSequence: 0,
    lastDeviceRegisteredAt: 0,
    records: {},
    deletedRecords: {},
  };
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRecordStates(value: unknown): Record<string, LocalRecordState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, LocalRecordState> = {};
  Object.entries(value as Record<string, Partial<LocalRecordState>>).forEach(([recordId, state]) => {
    if (!state || typeof state !== "object" || typeof state.contentHash !== "string") {
      return;
    }
    result[recordId] = {
      revision: finiteNumber(state.revision, 0),
      contentHash: state.contentHash,
      serverSequence: finiteNumber(state.serverSequence, 0),
      deletedAt: typeof state.deletedAt === "number" ? state.deletedAt : undefined,
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
    if (!record || record.kind !== "item" || typeof record.itemId !== "string") {
      return;
    }
    result[recordId] = {
      kind: "item",
      recordId,
      itemId: record.itemId,
      itemType: record.itemType ?? "login",
      itemName: record.itemName ?? "Deleted item",
      deletedAt: finiteNumber(record.deletedAt, Date.now()),
    };
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
    deviceId: typeof stored.deviceId === "string" && stored.deviceId ? stored.deviceId : fallback.deviceId,
    conflictCount: Math.max(0, finiteNumber(stored.conflictCount, 0)),
    serverSequence: Math.max(0, finiteNumber(stored.serverSequence, 0)),
    lastDeviceRegisteredAt: Math.max(0, finiteNumber(stored.lastDeviceRegisteredAt, 0)),
    records: normalizeRecordStates(stored.records),
    deletedRecords: normalizeDeletedRecords(stored.deletedRecords),
  };
}

async function readSyncState() {
  const stored = await SecureStore.getItemAsync(syncStateKey);
  if (!stored) {
    const next = syncStateFallback();
    await writeSyncState(next);
    return next;
  }

  try {
    const next = normalizeSyncState(JSON.parse(stored));
    await writeSyncState(next);
    return next;
  } catch {
    const next = syncStateFallback();
    await writeSyncState(next);
    return next;
  }
}

async function writeSyncState(state: LocalSyncState) {
  await SecureStore.setItemAsync(syncStateKey, JSON.stringify(state));
}

async function readPendingOAuthRequest() {
  const stored = await SecureStore.getItemAsync(pendingOAuthKey);
  if (!stored) {
    return undefined;
  }

  try {
    return JSON.parse(stored) as PendingOAuthRequest;
  } catch {
    await SecureStore.deleteItemAsync(pendingOAuthKey).catch(() => undefined);
    return undefined;
  }
}

async function writePendingOAuthRequest(request: PendingOAuthRequest) {
  await SecureStore.setItemAsync(pendingOAuthKey, JSON.stringify(request));
}

async function clearPendingOAuthRequest() {
  await SecureStore.deleteItemAsync(pendingOAuthKey).catch(() => undefined);
}

function client(idToken: string) {
  if (!convexUrl) {
    throw new Error("Set EXPO_PUBLIC_CONVEX_URL before using sync.");
  }
  return new ConvexHttpClient(convexUrl, { auth: idToken });
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
      return await session.getValidIdToken();
    } catch {
      return null;
    }
  });

  const unsubscribe = realtime.onUpdate(syncFns.getSyncStatus, {}, onUpdate, onError);
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

function aad(identityId: string, recordId: string, revision: number) {
  return textToBytes(canonicalJson({ identityId, recordId, revision, schemaVersion }));
}

async function wrapVaultKey(appKey: string, vaultKey: Uint8Array) {
  const sealed = await aesEncryptAsync(vaultKey, await aesKey(await deriveSyncKek(appKey)));
  return {
    iv: binaryToBase64(await sealed.iv("base64")),
    ciphertext: binaryToBase64(await sealed.ciphertext({ encoding: "base64" })),
    authTag: binaryToBase64(await sealed.tag("base64")),
    algorithm: "AES-256-GCM",
    derivation: "HKDF-SHA256-klarkey-sync-v1",
    wrappedAt: Date.now(),
  };
}

async function unwrapVaultKey(appKey: string, wrapped: { iv: string; ciphertext: string; authTag: string }) {
  const sealed = sealedFromBase64Parts(wrapped);
  const decrypted = await aesDecryptAsync(sealed, await aesKey(await deriveSyncKek(appKey)));
  return decrypted as Uint8Array;
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
    additionalData: aad(identityId, record.recordId, record.revision),
  });
  return JSON.parse(bytesToText(decrypted as Uint8Array)) as PlainMobileRecord;
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

function plainRecords(vault: MobileVaultState): PlainMobileRecord[] {
  return vault.items
    .filter((item) => !isDeviceLocalPasskeyItem(item))
    .map((item) => ({
      kind: "item",
      recordId: `item:${item.id}`,
      itemId: item.id,
      itemType: item.itemType,
      item: mobileItemToSyncInput(item),
      updatedAt: item.updatedAt ?? item.createdAt ?? item.id,
    }));
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
    content: item.content,
    notes: item.notes,
    websites: item.websites,
    customFields: item.customFields,
    recoveryCodes: item.recoveryCodes ?? [],
    ssoProvider: item.ssoProvider,
  };
}

function applyPlainRecord(vault: MobileVaultState, record: PlainMobileRecord) {
  if (record.deletedAt) {
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
    itemId: record.itemId,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
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
  if (record.kind !== "item" || record.deletedAt) {
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

function addMissingItemTombstones(state: LocalSyncState, activeRecordIds: Set<string>) {
  const deletedAt = Date.now();
  Object.entries(state.records).forEach(([recordId, record]) => {
    if (!recordId.startsWith("item:") || activeRecordIds.has(recordId) || record.deletedAt || state.deletedRecords[recordId]) {
      return;
    }
    const itemId = recordId.slice("item:".length);
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
  });
}

function sessionAccountName() {
  const snapshot = session?.getState().snapshot;
  if (!snapshot?.id_token) {
    return undefined;
  }
  const parsed = decodeJwtPayload(snapshot.id_token);
  return parsed?.email ?? parsed?.name;
}

function decodeJwtPayload(idToken: string) {
  try {
    const [, payload] = idToken.split(".");
    return JSON.parse(bytesToText(base64ToBytes(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")))) as { sub?: string; email?: string; name?: string };
  } catch {
    return undefined;
  }
}

function sessionIdentityId() {
  const idToken = session?.getState().snapshot?.id_token;
  const subject = idToken ? decodeJwtPayload(idToken)?.sub : undefined;
  if (!subject) {
    throw new Error("Ave identity id is missing from the mobile session.");
  }
  return subject;
}

export async function getMobileSyncStatus(): Promise<SyncStatus> {
  const state = await readSyncState();
  let sessionError: string | undefined;
  if (session) {
    try {
      await session.hydrate();
    } catch (error) {
      sessionError = error instanceof Error ? error.message : "Sync session could not be loaded.";
    }
  }
  return {
    configured: Boolean(oauth && convexUrl),
    signedIn: session?.getState().status === "signedIn",
    syncing: false,
    deviceId: state.deviceId,
    deviceName: "Mobile",
    accountName: sessionAccountName(),
    lastSyncAt: await SecureStore.getItemAsync(`${syncStateKey}.lastSyncAt`) ?? undefined,
    lastError: sessionError ?? await SecureStore.getItemAsync(`${syncStateKey}.lastError`) ?? undefined,
    conflictCount: state.conflictCount,
    serverSequence: state.serverSequence,
  };
}

export async function signInMobileSync() {
  if (!oauth || !session) {
    throw new Error("Set EXPO_PUBLIC_AVE_CLIENT_ID before using sync.");
  }

  const verifier = generateCodeVerifier();
  const state = Crypto.randomUUID();
  const nonce = generateNonce();
  const codeChallenge = await generateCodeChallenge(verifier);
  await writePendingOAuthRequest({
    state,
    verifier,
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
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    await clearPendingOAuthRequest();
    throw new Error("Sync sign-in expired. Start again from Settings.");
  }

  await completeExpoOAuthCallback(session, oauth, {
    code: parsed.code,
    codeVerifier: pending.verifier,
    expectedState: pending.state,
    responseState: parsed.state ?? undefined,
    redirectUrlWithFragment: parsed.urlForAppKeyMerge,
  });
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

  await session.hydrate();
  const idToken = await session.getValidIdToken();
  const appKey = session.getAppKeyBase64();
  if (!idToken || !appKey) {
    throw new Error("Sign in with Ave before syncing.");
  }

  const state = await readSyncState();
  const remote = client(idToken);
  const identityId = sessionIdentityId();
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
  const pull = await remote.query(syncFns.pullSince, {
    since,
    limit: 500,
  }) as { wrappedVaultKey?: { iv: string; ciphertext: string; authTag: string }; sequence: number; records: EncryptedRecord[] };
  let vaultKey = pull.wrappedVaultKey
    ? await unwrapVaultKey(appKey, pull.wrappedVaultKey)
    : Crypto.getRandomBytes(32);

  if (!pull.wrappedVaultKey) {
    const setup = await remote.mutation(syncFns.bootstrapVault, {
      schemaVersion,
      wrappedVaultKey: await wrapVaultKey(appKey, vaultKey),
    }) as { wrappedVaultKey?: { iv: string; ciphertext: string; authTag: string } };
    if (setup.wrappedVaultKey) {
      vaultKey = await unwrapVaultKey(appKey, setup.wrappedVaultKey);
    }
  }
  let nextVault = vault;
  let decryptFailures = 0;
  let appliedRecords = 0;
  for (const record of pull.records) {
    const current = state.records[record.recordId];
    if (current?.contentHash === record.contentHash) {
      if (record.deletedAt) {
        try {
          nextVault = applyPlainRecord(nextVault, await decryptRecord(vaultKey, identityId, record));
          appliedRecords += 1;
        } catch {
          decryptFailures += 1;
        }
      }
      state.records[record.recordId] = {
        revision: Math.max(current.revision, record.revision),
        contentHash: record.contentHash,
        serverSequence: record.serverSequence,
        deletedAt: record.deletedAt,
      };
      if (record.deletedAt) {
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
        revision: record.revision,
        contentHash: "",
        serverSequence: record.serverSequence,
        deletedAt: record.deletedAt,
      };
      state.serverSequence = Math.max(state.serverSequence, record.serverSequence);
      continue;
    }
    nextVault = applyPlainRecord(nextVault, plain);
    appliedRecords += 1;
    state.records[record.recordId] = {
      revision: record.revision,
      contentHash: record.contentHash,
      serverSequence: record.serverSequence,
      deletedAt: record.deletedAt,
    };
    if (record.deletedAt) {
      delete state.deletedRecords[record.recordId];
    }
    state.serverSequence = Math.max(state.serverSequence, record.serverSequence);
  }

  const recordsToPush = [];
  const activeRecords = plainRecords(nextVault);
  const activeRecordIds = new Set(activeRecords.map((record) => record.recordId));
  addMissingItemTombstones(state, activeRecordIds);
  const plainRecordsToPush = [
    ...activeRecords,
    ...Object.values(state.deletedRecords).map(deletedRecordToPlainRecord),
  ];
  const plainById = new Map<string, PlainMobileRecord>();
  const encryptedById = new Map<string, Awaited<ReturnType<typeof encryptRecord>>>();

  for (const record of plainRecordsToPush) {
    const hash = await recordHash(record);
    const current = state.records[record.recordId];
    if (current?.contentHash === hash) {
      if (record.deletedAt) {
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
    const pushed = await remote.mutation(syncFns.pushBatch, { records: recordsToPush }) as { sequence: number; accepted: PushAccepted[]; conflicts: EncryptedRecord[] };
    pushed.accepted.forEach((record) => {
      const encrypted = encryptedById.get(record.recordId);
      state.records[record.recordId] = {
        revision: record.revision,
        contentHash: record.contentHash,
        serverSequence: record.serverSequence,
        deletedAt: encrypted?.deletedAt,
      };
      if (encrypted?.deletedAt) {
        delete state.deletedRecords[record.recordId];
      }
    });
    for (const conflict of pushed.conflicts) {
      const local = plainById.get(conflict.recordId);
      if (local) {
        nextVault = preserveConflictCopy(nextVault, local);
      }
      try {
        nextVault = applyPlainRecord(nextVault, await decryptRecord(vaultKey, identityId, conflict));
      } catch {
        decryptFailures += 1;
      }
      delete state.deletedRecords[conflict.recordId];
      state.records[conflict.recordId] = {
        revision: conflict.revision,
        contentHash: conflict.contentHash,
        serverSequence: conflict.serverSequence,
        deletedAt: conflict.deletedAt,
      };
      state.serverSequence = Math.max(state.serverSequence, conflict.serverSequence);
    }
    state.conflictCount += pushed.conflicts.length;
    state.serverSequence = Math.max(state.serverSequence, pushed.sequence);
  }

  await writeSyncState(state);
  await SecureStore.setItemAsync(`${syncStateKey}.lastSyncAt`, new Date().toISOString());
  if (decryptFailures > 0) {
    await SecureStore.setItemAsync(`${syncStateKey}.lastError`, `${decryptFailures} sync record${decryptFailures === 1 ? "" : "s"} need repair from another device.`);
  } else {
    await SecureStore.deleteItemAsync(`${syncStateKey}.lastError`).catch(() => undefined);
  }
  return {
    status: await getMobileSyncStatus(),
    vault: nextVault,
    pulledCount: appliedRecords,
    pushedCount: recordsToPush.length,
    repairedCursor: repairCursor,
  };
}

export type { SyncStatus };
