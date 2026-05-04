import { requireOptionalNativeModule } from "expo";
import { NativeModules, Platform } from "react-native";

import { createProviderSavedLogin, normalizeMobilePasskey, type MobilePasskey, type MobileVaultItem, type MobileVaultState } from "@/lib/vault";

interface KlarkeyCredentialStoreModule {
  replaceCredentials: (payload: string, unlockedUntil: number) => Promise<void>;
  replacePasskeys?: (payload: string) => Promise<void>;
  getProviderCredentials?: () => Promise<string>;
  getProviderPasskeys?: () => Promise<string>;
  deleteProviderItem?: (itemId: string, passkeyIdsPayload: string) => Promise<void>;
  unlock?: (unlockedUntil: number) => Promise<void>;
  lock: () => Promise<void>;
}

interface ProviderSavedCredential {
  id: string;
  title: string;
  username: string;
  domain?: string;
  domains?: string[];
  password?: string;
  otpCode?: string;
  hasPassword?: boolean;
  hasOtp?: boolean;
  hasPasskey?: boolean;
  lastUsedAt?: string;
}

const nativeStore = NativeModules.KlarkeyCredentialStore as KlarkeyCredentialStoreModule | undefined;
const expoNativeStore = requireOptionalNativeModule<KlarkeyCredentialStoreModule>("KlarkeyCredentialStore") ?? undefined;
const unlockWindowMs = 5 * 60 * 1000;

function credentialStoreModule() {
  return Platform.OS === "ios" ? expoNativeStore : nativeStore;
}

function normalizeHost(value?: string) {
  return value?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.toLowerCase();
}

function credentialDomainsForItem(item: MobileVaultItem) {
  return Array.from(new Set([...item.websites, item.website].filter(Boolean)));
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function parseJsonArray(payload: string) {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeProviderCredential(value: unknown): ProviderSavedCredential | undefined {
  const record = objectRecord(value);
  const id = stringValue(record?.id)?.trim();
  const username = stringValue(record?.username)?.trim();
  const title = stringValue(record?.title)?.trim() || username;
  if (!id || !username || !title) {
    return undefined;
  }

  return {
    id,
    title,
    username,
    domain: stringValue(record?.domain),
    domains: stringArray(record?.domains),
    password: stringValue(record?.password),
    otpCode: stringValue(record?.otpCode),
    hasPassword: booleanValue(record?.hasPassword),
    hasOtp: booleanValue(record?.hasOtp),
    hasPasskey: booleanValue(record?.hasPasskey),
    lastUsedAt: stringValue(record?.lastUsedAt),
  };
}

function normalizeProviderPasskey(value: unknown): MobilePasskey | undefined {
  const record = objectRecord(value);
  const id = stringValue(record?.id)?.trim();
  const rpId = stringValue(record?.rpId)?.trim();
  const username = stringValue(record?.username)?.trim();
  if (!id || !rpId || !username) {
    return undefined;
  }

  const signCount = record && typeof record.signCount === "number" && Number.isFinite(record.signCount) ? record.signCount : 0;
  return normalizeMobilePasskey({
    id,
    rpId,
    username,
    userHandle: stringValue(record?.userHandle),
    itemId: stringValue(record?.itemId),
    transports: stringArray(record?.transports),
    privateKeyJwk: objectRecord(record?.privateKeyJwk) ?? stringValue(record?.privateKeyJwk),
    signCount,
    createdAt: stringValue(record?.createdAt),
    lastUsedAt: stringValue(record?.lastUsedAt),
    syncedCounter: record?.syncedCounter === true,
    providerBacked: record?.providerBacked === true && !objectRecord(record?.privateKeyJwk) && !stringValue(record?.privateKeyJwk),
  });
}

export function isProviderBackedPasskeyForItem(passkey: MobilePasskey, item: MobileVaultItem) {
  if (passkey.providerBacked !== true) {
    return false;
  }

  if (passkey.itemId && passkey.itemId === item.id) {
    return true;
  }

  if (!item.username || passkey.username !== item.username) {
    return false;
  }

  const host = normalizeHost(item.website);
  return !host || passkey.rpId === host;
}

function passkeyBelongsToItem(passkey: MobilePasskey, item: MobileVaultItem) {
  return passkey.itemId === item.id || isProviderBackedPasskeyForItem(passkey, item);
}

export async function syncNativeCredentialStore(vault: MobileVaultState) {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.replaceCredentials) {
    return;
  }

  const payload = vault.items
    .filter((item) => item.itemType === "login" && item.username)
    .map((item) => {
      const domains = credentialDomainsForItem(item);

      return {
        id: item.id,
        title: item.itemName,
        username: item.username,
        domain: domains[0],
        domains,
        password: item.password,
        otpCode: item.otpCode,
        hasPassword: Boolean(item.password),
        hasOtp: Boolean(item.otpCode),
        hasPasskey: vault.passkeys.some((passkey) => passkeyBelongsToItem(passkey, item)),
        lastUsedAt: item.lastUsedAt ?? item.updatedAt ?? item.createdAt ?? item.id,
      };
    });

  await store.replaceCredentials(JSON.stringify(payload), Date.now() + unlockWindowMs);
  if (store.replacePasskeys) {
    const passkeys = vault.passkeys
      .filter((passkey) => passkey.privateKeyJwk && passkey.itemId)
      .map((passkey) => ({
        id: passkey.id,
        rpId: passkey.rpId,
        username: passkey.username,
        userHandle: passkey.userHandle,
        itemId: passkey.itemId,
        transports: passkey.transports ?? ["internal"],
        privateKeyJwk: passkey.privateKeyJwk,
        signCount: 0,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
        syncedCounter: true,
        providerBacked: false,
      }));
    await store.replacePasskeys(JSON.stringify(passkeys));
  }
}

export async function lockNativeCredentialStore() {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.lock) {
    return;
  }

  await store.lock();
}

export async function unlockNativeCredentialStore(unlockedUntil = Date.now() + unlockWindowMs) {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.unlock) {
    return;
  }

  await store.unlock(unlockedUntil);
}

export async function deleteNativeProviderItem(itemId: string, passkeyIds: string[]) {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.deleteProviderItem) {
    return;
  }

  await store.deleteProviderItem(itemId, JSON.stringify(passkeyIds));
}

export async function loadNativeProviderCredentials(): Promise<MobileVaultItem[]> {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.getProviderCredentials) {
    return [];
  }

  try {
    const payload = await store.getProviderCredentials();
    return parseJsonArray(payload).map(normalizeProviderCredential).filter(present).map(createProviderSavedLogin);
  } catch {
    return [];
  }
}

export async function loadNativeProviderCredentialIndex(): Promise<MobileVaultItem[]> {
  const credentials = await loadNativeProviderCredentials();
  return credentials.map((item) => ({
    ...item,
    password: undefined,
    otp: undefined,
    otpCode: undefined,
  }));
}

export async function loadNativeProviderPasskeys(): Promise<MobilePasskey[]> {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.getProviderPasskeys) {
    return [];
  }

  try {
    const payload = await store.getProviderPasskeys();
    return parseJsonArray(payload).map(normalizeProviderPasskey).filter(present);
  } catch {
    return [];
  }
}

export async function loadNativeProviderPasskeyIndex(): Promise<MobilePasskey[]> {
  const passkeys = await loadNativeProviderPasskeys();
  return passkeys.map((passkey) => ({
    ...passkey,
    userHandle: undefined,
    privateKeyJwk: undefined,
  }));
}
