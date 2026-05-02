import { requireOptionalNativeModule } from "expo";
import { NativeModules, Platform } from "react-native";

import { createProviderSavedLogin, type MobilePasskey, type MobileVaultItem, type MobileVaultState } from "@/lib/vault";

interface KlarkeyCredentialStoreModule {
  replaceCredentials: (payload: string, unlockedUntil: number) => Promise<void>;
  getProviderCredentials?: () => Promise<string>;
  getProviderPasskeys?: () => Promise<string>;
  deleteProviderItem?: (itemId: string, passkeyIdsPayload: string) => Promise<void>;
  lock: () => Promise<void>;
}

interface ProviderSavedCredential {
  id: string;
  title: string;
  username: string;
  domain?: string;
  domains?: string[];
  password?: string;
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
        hasPasskey: vault.passkeys.some((passkey) => isProviderBackedPasskeyForItem(passkey, item)),
        lastUsedAt: Date.now(),
      };
    });

  await store.replaceCredentials(JSON.stringify(payload), Date.now() + unlockWindowMs);
}

export async function lockNativeCredentialStore() {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.lock) {
    return;
  }

  await store.lock();
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

  const payload = await store.getProviderCredentials();
  const credentials = JSON.parse(payload) as ProviderSavedCredential[];
  return credentials.map(createProviderSavedLogin);
}

export async function loadNativeProviderPasskeys(): Promise<MobilePasskey[]> {
  const store = credentialStoreModule();
  if ((Platform.OS !== "android" && Platform.OS !== "ios") || !store?.getProviderPasskeys) {
    return [];
  }

  const payload = await store.getProviderPasskeys();
  const passkeys = JSON.parse(payload) as MobilePasskey[];
  return passkeys.map((passkey) => ({
    ...passkey,
    providerBacked: true,
  }));
}
