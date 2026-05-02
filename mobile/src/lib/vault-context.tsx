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
  updateVaultItem,
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
  deviceCredentialEnrolled: boolean;
  authAvailable: boolean;
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
  updateItem: (id: string, input: NewItemInput) => Promise<MobileVaultItem | undefined>;
  deleteItem: (id: string) => Promise<void>;
  updateAutoLockMinutes: (minutes: AutoLockMinutes) => Promise<void>;
  copyValue: (label: string, value?: string) => Promise<void>;
}

const MobileVaultContext = createContext<MobileVaultContextValue | null>(null);

const initialSupport: NativeSupport = {
  secureStore: false,
  biometricHardware: false,
  biometricEnrolled: false,
  deviceCredentialEnrolled: false,
  authAvailable: false,
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

async function loadSyncedVaultState() {
  const storedVault = await loadVaultState();
  const providerCredentials = await loadNativeProviderCredentials();
  const providerPasskeys = await loadNativeProviderPasskeys();
  const passkeys = mergePasskeys(storedVault.passkeys, providerPasskeys);
  const items = linkPasskeysToItems(mergeProviderCredentials(storedVault.items, providerCredentials), passkeys);

  return {
    vault: {
      ...storedVault,
      items,
      passkeys,
    },
    providerCredentials,
    providerPasskeys,
  };
}

async function loadLockedVaultIndex() {
  const { vault } = await loadSyncedVaultState();
  return redactVaultState(vault);
}

function redactVaultState(state: MobileVaultState): MobileVaultState {
  return {
    items: state.items.map(redactVaultItem),
    passkeys: state.passkeys.map((passkey) => ({
      ...passkey,
      username: passkey.username,
    })),
  };
}

function redactVaultItem(item: MobileVaultItem): MobileVaultItem {
  return {
    ...item,
    password: undefined,
    otp: undefined,
    otpCode: undefined,
    fullName: item.itemType === "identity" ? item.fullName : undefined,
    firstName: undefined,
    middleName: undefined,
    lastName: undefined,
    birthDate: undefined,
    email: item.itemType === "login" ? item.email : undefined,
    phone: undefined,
    address: undefined,
    addressLine1: undefined,
    addressLine2: undefined,
    city: undefined,
    state: undefined,
    postalCode: undefined,
    country: undefined,
    cardholderName: undefined,
    cardNumber: undefined,
    cardExpiry: undefined,
    cardExpiryMonth: undefined,
    cardExpiryYear: undefined,
    cardCvc: undefined,
    billingPostalCode: undefined,
    sshPrivateKey: undefined,
    sshComment: undefined,
    content: undefined,
    notes: undefined,
    customFields: [],
  };
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
      const [secureStore, biometricHardware, biometricEnrolled, enrolledLevel] = await Promise.all([
        import("expo-secure-store").then((module) => module.isAvailableAsync()),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
      ]);
      const deviceCredentialEnrolled = enrolledLevel >= LocalAuthentication.SecurityLevel.SECRET;
      const authAvailable = biometricEnrolled || deviceCredentialEnrolled;
      const [storedSettings, lockedVault] = await Promise.all([loadVaultSettings(), secureStore ? loadLockedVaultIndex() : Promise.resolve({ items: [], passkeys: [] })]);

      if (!mounted) {
        return;
      }

      setSupport({
        secureStore,
        biometricHardware,
        biometricEnrolled,
        deviceCredentialEnrolled,
        authAvailable,
      });
      setVault(lockedVault);
      setSettings(storedSettings);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
    setVault((current) => redactVaultState(current));
    setLastEvent(undefined);
    backgroundedAt.current = undefined;
    void lockNativeCredentialStore();
  }, []);

  const refreshProviderVault = useCallback(async () => {
    const { vault: nextVault, providerCredentials, providerPasskeys } = await loadSyncedVaultState();
    if (providerCredentials.length === 0 && providerPasskeys.length === 0) {
      return;
    }

    setVault(nextVault);
    await saveVaultState(nextVault);
    await syncNativeCredentialStore(nextVault);
  }, []);

  const refreshLockedProviderVault = useCallback(async () => {
    const { vault: nextVault, providerCredentials, providerPasskeys } = await loadSyncedVaultState();
    if (providerCredentials.length === 0 && providerPasskeys.length === 0) {
      return;
    }

    setVault(redactVaultState(nextVault));
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
        if (state === "active") {
          void refreshLockedProviderVault();
        }
        return;
      }

      if (state !== "active") {
        backgroundedAt.current = Date.now();
        return;
      }

      if (backgroundedAt.current && Date.now() - backgroundedAt.current >= settings.autoLockMinutes * 60 * 1000) {
        lock();
        return;
      }

      backgroundedAt.current = undefined;
      void refreshProviderVault();
    });

    return () => subscription.remove();
  }, [lock, locked, refreshLockedProviderVault, refreshProviderVault, settings.autoLockMinutes]);

  const unlock = useCallback(async () => {
    setLoading(true);
    try {
      if (!support.authAvailable) {
        setLastEvent("Set a screen lock on this device before using Klarkey.");
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Klarkey",
        promptSubtitle: "Klarkey",
        promptDescription: "Confirm it is you to open your vault.",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
        ...(support.biometricEnrolled ? { biometricsSecurityLevel: "strong" as const } : {}),
      });

      if (!result.success) {
        setLastEvent(result.error === "not_enrolled" || result.error === "passcode_not_set" ? "Set a device passcode or password to unlock Klarkey." : "Unlock canceled.");
        return;
      }

      const { vault: nextVault, providerCredentials, providerPasskeys } = await loadSyncedVaultState();
      await syncNativeCredentialStore(nextVault);
      if (providerCredentials.length > 0 || providerPasskeys.length > 0) {
        await saveVaultState(nextVault);
      }
      setVault(nextVault);
      setLocked(false);
      setLastEvent(undefined);
      backgroundedAt.current = undefined;
    } finally {
      setLoading(false);
    }
  }, [support.authAvailable, support.biometricEnrolled]);

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

  const updateItem = useCallback(
    async (id: string, input: NewItemInput) => {
      if (!input.itemName.trim()) {
        setLastEvent("Name is required.");
        return undefined;
      }

      const currentItem = vault.items.find((candidate) => candidate.id === id);
      if (!currentItem) {
        setLastEvent("Item could not be found.");
        return undefined;
      }

      setLoading(true);
      try {
        const item = updateVaultItem(currentItem, input);
        const nextItem = {
          ...item,
          hasPasskey: vault.passkeys.some((passkey) => isProviderBackedPasskeyForItem(passkey, item)),
        };
        const nextVault = {
          ...vault,
          items: vault.items.map((candidate) => (candidate.id === id ? nextItem : candidate)),
        };
        setVault(nextVault);
        await saveVaultState(nextVault);
        await syncNativeCredentialStore(nextVault);
        setLastEvent(`${nextItem.itemName} updated.`);
        return nextItem;
      } finally {
        setLoading(false);
      }
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
      updateItem,
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
      updateItem,
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
