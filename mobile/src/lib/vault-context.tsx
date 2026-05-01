import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { AppState } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  isProviderBackedPasskeyForItem,
  loadNativeProviderCredentials,
  loadNativeProviderPasskeys,
  lockNativeCredentialStore,
  syncNativeCredentialStore,
} from "@/lib/native-credential-store";
import {
  createVaultItem,
  loadVaultState,
  loadVaultSettings,
  saveVaultState,
  saveVaultSettings,
  type AutoLockMinutes,
  type MobilePasskey,
  type MobileVaultItem,
  type MobileVaultSettings,
  type NewItemInput,
  type MobileVaultState,
} from "@/lib/vault";

interface NativeSupport {
  secureStore: boolean;
  biometricHardware: boolean;
  biometricEnrolled: boolean;
}

interface MobileVaultContextValue {
  locked: boolean;
  loading: boolean;
  support: NativeSupport;
  vault: MobileVaultState;
  settings: MobileVaultSettings;
  lastEvent?: string;
  unlock: () => Promise<void>;
  createItem: (input: NewItemInput) => Promise<boolean>;
  deleteItem: (id: string) => Promise<void>;
  updateAutoLockMinutes: (minutes: AutoLockMinutes) => Promise<void>;
  copyValue: (label: string, value?: string) => Promise<void>;
}

const MobileVaultContext = createContext<MobileVaultContextValue | null>(null);

const initialSupport: NativeSupport = {
  secureStore: false,
  biometricHardware: false,
  biometricEnrolled: false,
};

function mergePasskeys(storedPasskeys: MobilePasskey[], providerPasskeys: MobilePasskey[]) {
  const byId = new Map(storedPasskeys.map((passkey) => [passkey.id, passkey]));
  providerPasskeys.forEach((passkey) => byId.set(passkey.id, passkey));
  return Array.from(byId.values());
}

function mergeProviderCredentials(items: MobileVaultItem[], providerItems: MobileVaultItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  providerItems.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
  return Array.from(byId.values());
}

function linkPasskeysToItems(items: MobileVaultItem[], passkeys: MobilePasskey[]) {
  return items.map((item) => ({
    ...item,
    hasPasskey: item.itemType === "login" ? passkeys.some((passkey) => isProviderBackedPasskeyForItem(passkey, item)) : item.hasPasskey,
  }));
}

export function MobileVaultProvider({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastEvent, setLastEvent] = useState<string>();
  const [support, setSupport] = useState(initialSupport);
  const [settings, setSettings] = useState<MobileVaultSettings>({
    autoLockMinutes: 15,
  });
  const [vault, setVault] = useState<MobileVaultState>({
    items: [],
    passkeys: [],
  });
  const backgroundedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const [secureStore, biometricHardware, biometricEnrolled] = await Promise.all([
        import("expo-secure-store").then((module) => module.isAvailableAsync()),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const storedSettings = await loadVaultSettings();

      if (!mounted) {
        return;
      }

      setSupport({
        secureStore,
        biometricHardware,
        biometricEnrolled,
      });
      setSettings(storedSettings);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
    setVault({ items: [], passkeys: [] });
    setLastEvent(undefined);
    backgroundedAt.current = undefined;
    void lockNativeCredentialStore();
  }, []);

  useEffect(() => {
    if (locked) {
      return undefined;
    }

    const timeout = setTimeout(lock, settings.autoLockMinutes * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [lock, locked, settings.autoLockMinutes, vault]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (locked) {
        return;
      }

      if (state !== "active") {
        backgroundedAt.current = Date.now();
        return;
      }

      if (backgroundedAt.current && Date.now() - backgroundedAt.current >= settings.autoLockMinutes * 60 * 1000) {
        lock();
      }
    });

    return () => subscription.remove();
  }, [lock, locked, settings.autoLockMinutes]);

  const unlock = useCallback(async () => {
    setLoading(true);
    if (support.biometricHardware && support.biometricEnrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Klarkey",
        cancelLabel: "Cancel",
        biometricsSecurityLevel: "strong",
      });

      if (!result.success) {
        setLastEvent("Unlock canceled.");
        setLoading(false);
        return;
      }
    }

    const storedVault = await loadVaultState();
    const providerCredentials = await loadNativeProviderCredentials();
    const providerPasskeys = await loadNativeProviderPasskeys();
    const passkeys = mergePasskeys(storedVault.passkeys, providerPasskeys);
    const nextVault = {
      ...storedVault,
      items: linkPasskeysToItems(mergeProviderCredentials(storedVault.items, providerCredentials), passkeys),
      passkeys,
    };
    await syncNativeCredentialStore(nextVault);
    if (providerCredentials.length > 0 || providerPasskeys.length > 0) {
      await saveVaultState(nextVault);
    }
    setVault(nextVault);
    setLocked(false);
    setLastEvent(undefined);
    backgroundedAt.current = undefined;
    setLoading(false);
  }, [support.biometricEnrolled, support.biometricHardware]);

  const createItem = useCallback(
    async (input: NewItemInput) => {
      if (!input.itemName.trim()) {
        setLastEvent("Name is required.");
        return false;
      }

      setLoading(true);
      const item = createVaultItem(input);
      const nextItem = {
        ...item,
        hasPasskey: vault.passkeys.some((passkey) => isProviderBackedPasskeyForItem(passkey, item)),
      };
      const nextVault = {
        ...vault,
        items: [nextItem, ...vault.items],
      };
      setVault(nextVault);
      await saveVaultState(nextVault);
      await syncNativeCredentialStore(nextVault);
      setLastEvent(`${nextItem.itemName} saved.`);
      setLoading(false);
      return true;
    },
    [vault],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const item = vault.items.find((candidate) => candidate.id === id);
      const nextVault = {
        ...vault,
        items: vault.items.filter((candidate) => candidate.id !== id),
      };
      setVault(nextVault);
      await saveVaultState(nextVault);
      await syncNativeCredentialStore(nextVault);
      setLastEvent(item ? `${item.itemName} deleted.` : "Item deleted.");
    },
    [vault],
  );

  const updateAutoLockMinutes = useCallback(async (autoLockMinutes: AutoLockMinutes) => {
    const nextSettings = { autoLockMinutes };
    setSettings(nextSettings);
    await saveVaultSettings(nextSettings);
  }, []);

  const copyValue = useCallback(async (label: string, value?: string) => {
    if (!value) {
      setLastEvent(`${label} is empty.`);
      return;
    }

    await Clipboard.setStringAsync(value);
    setLastEvent(`${label} copied.`);
  }, []);

  const value = useMemo(
    () => ({
      locked,
      loading,
      support,
      vault,
      settings,
      lastEvent,
      unlock,
      createItem,
      deleteItem,
      updateAutoLockMinutes,
      copyValue,
    }),
    [
      copyValue,
      createItem,
      deleteItem,
      lastEvent,
      loading,
      locked,
      settings,
      support,
      unlock,
      updateAutoLockMinutes,
      vault,
    ],
  );

  return <MobileVaultContext.Provider value={value}>{children}</MobileVaultContext.Provider>;
}

export function useMobileVault() {
  const value = useContext(MobileVaultContext);
  if (!value) {
    throw new Error("useMobileVault must be used inside MobileVaultProvider");
  }
  return value;
}
