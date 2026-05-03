import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteNativeProviderItem,
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
  normalizeMobilePasskey,
  type AutoLockMinutes,
  type MobilePasskey,
  type MobileVaultItem,
  type MobileVaultSettings,
  type NewItemInput,
  type MobileVaultState,
} from "@/lib/vault";
import {
  completeMobileSyncCallback,
  getMobileSyncStatus,
  queueMobileSyncDeletedItem,
  signInMobileSync,
  signOutMobileSync,
  syncMobileVault,
  watchMobileSyncStatus,
  type SyncStatus,
} from "@/lib/sync";

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
  syncStatus: SyncStatus;
  lastEvent?: string;
  unlock: () => Promise<void>;
  createItem: (input: NewItemInput) => Promise<boolean>;
  updateItem: (id: string, input: NewItemInput) => Promise<MobileVaultItem | undefined>;
  deleteItem: (id: string) => Promise<void>;
  updateAutoLockMinutes: (minutes: AutoLockMinutes) => Promise<void>;
  completeSyncCallback: (url: string) => Promise<void>;
  syncSignIn: () => Promise<void>;
  syncSignOut: () => Promise<void>;
  syncNow: () => Promise<void>;
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

const initialSyncStatus: SyncStatus = {
  configured: false,
  signedIn: false,
  syncing: false,
  deviceId: "mobile",
  deviceName: "Mobile",
  conflictCount: 0,
  serverSequence: 0,
};

const supportHintKey = "klarkey.mobile.unlock-support.v1";
const syncSignInUiTimeoutMs = 1600;
const syncCallbackUiTimeoutMs = 5000;
const automaticSyncCooldownMs = 30000;

type SyncReason = "foreground" | "remote" | "local" | "manual";

async function loadSupportHint() {
  try {
    const stored = await SecureStore.getItemAsync(supportHintKey);
    return stored ? JSON.parse(stored) as NativeSupport : undefined;
  } catch {
    return undefined;
  }
}

async function saveSupportHint(support: NativeSupport) {
  try {
    await SecureStore.setItemAsync(supportHintKey, JSON.stringify(support));
  } catch {
    return;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function syncReasonPriority(reason: SyncReason) {
  if (reason === "manual") {
    return 4;
  }
  if (reason === "local") {
    return 3;
  }
  if (reason === "remote") {
    return 2;
  }
  return 1;
}

function mergeSyncReason(current: SyncReason | undefined, next: SyncReason) {
  if (!current || syncReasonPriority(next) > syncReasonPriority(current)) {
    return next;
  }
  return current;
}

function syncErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  if (message.length > 180 || message.includes("Convex's supported types") || message.includes("Uint8Array") || message.includes("[fromParts]")) {
    return fallback;
  }
  return message;
}

function mergePasskeys(storedPasskeys: MobilePasskey[], providerPasskeys: MobilePasskey[]) {
  const byId = new Map<string, MobilePasskey>();
  [...storedPasskeys, ...providerPasskeys].map(normalizeMobilePasskey).forEach((passkey) => {
    byId.set(passkey.id, passkey);
  });
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

function removedItems(previousVault: MobileVaultState, nextVault: MobileVaultState) {
  const nextItemIds = new Set(nextVault.items.map((item) => item.id));
  return previousVault.items.filter((item) => !nextItemIds.has(item.id));
}

async function deleteNativeProviderRecordsForRemovedItems(previousVault: MobileVaultState, nextVault: MobileVaultState) {
  const deletedItems = removedItems(previousVault, nextVault);
  for (const item of deletedItems) {
    const linkedPasskeys = previousVault.passkeys.filter((passkey) => isProviderBackedPasskeyForItem(passkey, item));
    await deleteNativeProviderItem(item.id, linkedPasskeys.map((passkey) => passkey.id));
  }
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

async function loadOptionalSyncStatus() {
  try {
    const status = await getMobileSyncStatus();
    return {
      ...status,
      lastError: status.lastError ? syncErrorMessage(status.lastError, "Sync is unavailable.") : undefined,
    };
  } catch (error) {
    return {
      ...initialSyncStatus,
      lastError: syncErrorMessage(error, "Sync is unavailable."),
    };
  }
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initialSyncStatus);
  const [vault, setVault] = useState<MobileVaultState>({
    items: [],
    passkeys: [],
  });
  const backgroundedAt = useRef<number | undefined>(undefined);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncRunning = useRef(false);
  const queuedSyncReason = useRef<SyncReason | undefined>(undefined);
  const scheduledSyncReason = useRef<SyncReason | undefined>(undefined);
  const observedRemoteSequence = useRef(0);
  const lastSyncFinishedAt = useRef(0);
  const vaultRef = useRef(vault);
  const syncStatusRef = useRef(syncStatus);
  const lockedRef = useRef(locked);
  const runSyncRef = useRef<(showEvent?: boolean, reason?: SyncReason) => Promise<void>>(async () => undefined);

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => () => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const supportHint = await loadSupportHint();
      if (mounted && supportHint) {
        setSupport(supportHint);
      }

      const [secureStore, biometricHardware, biometricEnrolled, enrolledLevel] = await Promise.all([
        SecureStore.isAvailableAsync(),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
      ]);
      const deviceCredentialEnrolled = enrolledLevel >= LocalAuthentication.SecurityLevel.SECRET;
      const authAvailable = biometricEnrolled || deviceCredentialEnrolled;
      const [storedSettings, lockedVault, storedSyncStatus] = await Promise.all([
        loadVaultSettings(),
        secureStore ? loadLockedVaultIndex() : Promise.resolve({ items: [], passkeys: [] }),
        loadOptionalSyncStatus(),
      ]);

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
      void saveSupportHint({
        secureStore,
        biometricHardware,
        biometricEnrolled,
        deviceCredentialEnrolled,
        authAvailable,
      });
      setVault(lockedVault);
      setSettings(storedSettings);
      setSyncStatus(storedSyncStatus);
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

    vaultRef.current = nextVault;
    setVault(nextVault);
    await saveVaultState(nextVault);
    await syncNativeCredentialStore(nextVault);
  }, []);

  const refreshLockedProviderVault = useCallback(async () => {
    const { vault: nextVault, providerCredentials, providerPasskeys } = await loadSyncedVaultState();
    if (providerCredentials.length === 0 && providerPasskeys.length === 0) {
      return;
    }

    vaultRef.current = redactVaultState(nextVault);
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

  useEffect(() => {
    runSyncRef.current = async (showEvent = false, reason = "foreground") => {
      if (lockedRef.current) {
        if (showEvent) {
          setLastEvent("Unlock Klarkey before syncing.");
        }
        return;
      }

      if (syncRunning.current) {
        if (reason !== "foreground") {
          queuedSyncReason.current = mergeSyncReason(queuedSyncReason.current, reason);
        }
        return;
      }

      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = undefined;
        scheduledSyncReason.current = undefined;
      }
      syncRunning.current = true;
      let completed = false;
      const syncingStatus = {
        ...syncStatusRef.current,
        syncing: true,
        lastError: undefined,
      };
      syncStatusRef.current = syncingStatus;
      setSyncStatus(syncingStatus);
      if (showEvent) {
        setLoading(true);
        setLastEvent("Syncing.");
      }

      try {
        const previousVault = vaultRef.current;
        const result = await syncMobileVault(previousVault, { fullPull: showEvent });
        await deleteNativeProviderRecordsForRemovedItems(previousVault, result.vault);
        vaultRef.current = result.vault;
        syncStatusRef.current = result.status;
        observedRemoteSequence.current = Math.max(observedRemoteSequence.current, result.status.serverSequence);
        setVault(result.vault);
        setSyncStatus(result.status);
        await saveVaultState(result.vault);
        await syncNativeCredentialStore(result.vault);
        completed = true;
        if (showEvent) {
          setLastEvent(result.status.conflictCount > 0 ? `${result.status.conflictCount} conflict copy saved.` : "Sync complete.");
        } else if (result.pulledCount > 0 || result.pushedCount > 0 || result.repairedCursor) {
          setLastEvent("Sync complete.");
        }
      } catch (error) {
        const message = syncErrorMessage(error, "Sync failed while uploading encrypted changes.");
        const next = await getMobileSyncStatus();
        const status = { ...next, lastError: message };
        syncStatusRef.current = status;
        setSyncStatus(status);
        if (showEvent) {
          setLastEvent(message);
        }
      } finally {
        syncRunning.current = false;
        lastSyncFinishedAt.current = Date.now();
        if (showEvent) {
          setLoading(false);
        }

        const nextReason = queuedSyncReason.current;
        const shouldRunAgain = completed && Boolean(nextReason);
        queuedSyncReason.current = undefined;

        if (shouldRunAgain && nextReason) {
          scheduledSyncReason.current = nextReason;
          syncTimer.current = setTimeout(() => {
            const scheduledReason = scheduledSyncReason.current ?? nextReason;
            scheduledSyncReason.current = undefined;
            syncTimer.current = undefined;
            void runSyncRef.current(false, scheduledReason);
          }, 900);
        }
      }
    };
  }, []);

  const runSync = useCallback(async (showEvent = false, reason: SyncReason = "foreground") => {
    await runSyncRef.current(showEvent, reason);
  }, []);

  const scheduleSync = useCallback((delay = 900, reason: SyncReason = "foreground") => {
    if (lockedRef.current || !syncStatusRef.current.signedIn) {
      return;
    }

    if (reason === "foreground" && lastSyncFinishedAt.current > 0 && Date.now() - lastSyncFinishedAt.current < automaticSyncCooldownMs) {
      return;
    }

    if (syncRunning.current) {
      if (reason !== "foreground") {
        queuedSyncReason.current = mergeSyncReason(queuedSyncReason.current, reason);
      }
      return;
    }

    scheduledSyncReason.current = mergeSyncReason(scheduledSyncReason.current, reason);
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }

    syncTimer.current = setTimeout(() => {
      const scheduledReason = scheduledSyncReason.current ?? reason;
      scheduledSyncReason.current = undefined;
      syncTimer.current = undefined;
      void runSync(false, scheduledReason);
    }, delay);
  }, [runSync]);

  useEffect(() => {
    if (locked || !syncStatus.signedIn) {
      return undefined;
    }

    observedRemoteSequence.current = syncStatusRef.current.serverSequence;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void watchMobileSyncStatus(
      (remote) => {
        if (!active) {
          return;
        }
        if (remote.sequence > syncStatusRef.current.serverSequence && remote.sequence > observedRemoteSequence.current) {
          observedRemoteSequence.current = remote.sequence;
          scheduleSync(150, "remote");
        }
      },
      (error) => {
        if (!active) {
          return;
        }
        const message = syncErrorMessage(error, "Realtime sync is unavailable.");
        setSyncStatus((current) => ({ ...current, lastError: message }));
      },
    ).then((dispose) => {
      if (active) {
        unsubscribe = dispose;
        return;
      }
      dispose();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [locked, scheduleSync, syncStatus.signedIn]);

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
      vaultRef.current = nextVault;
      setVault(nextVault);
      setLocked(false);
      setLastEvent(undefined);
      backgroundedAt.current = undefined;
      scheduleSync(250, "foreground");
    } finally {
      setLoading(false);
    }
  }, [scheduleSync, support.authAvailable, support.biometricEnrolled]);

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
      vaultRef.current = nextVault;
      setVault(nextVault);
      await saveVaultState(nextVault);
      await syncNativeCredentialStore(nextVault);
      setLastEvent(`${nextItem.itemName} saved.`);
      scheduleSync(900, "local");
      setLoading(false);
      return true;
    },
    [scheduleSync, vault],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const item = vault.items.find((candidate) => candidate.id === id);
      const linkedPasskeys = item ? vault.passkeys.filter((passkey) => isProviderBackedPasskeyForItem(passkey, item)) : [];
      const linkedPasskeyIds = new Set(linkedPasskeys.map((passkey) => passkey.id));
      if (item) {
        await queueMobileSyncDeletedItem(item);
      }
      const nextVault = {
        ...vault,
        items: vault.items.filter((candidate) => candidate.id !== id),
        passkeys: vault.passkeys.filter((passkey) => !linkedPasskeyIds.has(passkey.id)),
      };
      await deleteNativeProviderItem(id, linkedPasskeys.map((passkey) => passkey.id));
      vaultRef.current = nextVault;
      setVault(nextVault);
      await saveVaultState(nextVault);
      await syncNativeCredentialStore(nextVault);
      setLastEvent(item ? `${item.itemName} deleted.` : "Item deleted.");
      scheduleSync(900, "local");
    },
    [scheduleSync, vault],
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
        vaultRef.current = nextVault;
        setVault(nextVault);
        await saveVaultState(nextVault);
        await syncNativeCredentialStore(nextVault);
        setLastEvent(`${nextItem.itemName} updated.`);
        scheduleSync(900, "local");
        return nextItem;
      } finally {
        setLoading(false);
      }
    },
    [scheduleSync, vault],
  );

  const updateAutoLockMinutes = useCallback(async (autoLockMinutes: AutoLockMinutes) => {
    const nextSettings = { autoLockMinutes };
    setSettings(nextSettings);
    await saveVaultSettings(nextSettings);
  }, []);

  const applySyncConnectionStatus = useCallback((next: SyncStatus) => {
    syncStatusRef.current = next;
    setSyncStatus(next);
    setLastEvent(next.signedIn ? "Sync connected." : "Sync sign-in failed.");
    scheduleSync(250, "local");
  }, [scheduleSync]);

  const applySyncConnectionError = useCallback(async (error: unknown) => {
    const message = syncErrorMessage(error, "Sync sign-in failed.");
    const next = await loadOptionalSyncStatus();
    const status = { ...next, lastError: message };
    syncStatusRef.current = status;
    setSyncStatus(status);
    setLastEvent(message);
  }, []);

  const completeSyncCallback = useCallback(async (url: string) => {
    setLoading(true);
    const completion = completeMobileSyncCallback(url);
    try {
      const next = await Promise.race([
        completion,
        wait(syncCallbackUiTimeoutMs).then(() => undefined),
      ]);
      if (next) {
        applySyncConnectionStatus(next);
      } else {
        setLastEvent("Sync sign-in is finishing.");
        void completion.then(applySyncConnectionStatus).catch((error) => {
          void applySyncConnectionError(error);
        });
      }
    } catch (error) {
      await applySyncConnectionError(error);
    } finally {
      setLoading(false);
    }
  }, [applySyncConnectionError, applySyncConnectionStatus]);

  const syncSignIn = useCallback(async () => {
    setLoading(true);
    const completion = signInMobileSync();
    try {
      const next = await Promise.race([
        completion,
        wait(syncSignInUiTimeoutMs).then(() => undefined),
      ]);
      if (next) {
        applySyncConnectionStatus(next);
      } else {
        setLastEvent("Finish sign-in in Ave.");
        void completion.then(applySyncConnectionStatus).catch((error) => {
          void applySyncConnectionError(error);
        });
      }
    } catch (error) {
      await applySyncConnectionError(error);
    } finally {
      setLoading(false);
    }
  }, [applySyncConnectionError, applySyncConnectionStatus]);

  const syncSignOut = useCallback(async () => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
    const next = await signOutMobileSync();
    syncStatusRef.current = next;
    setSyncStatus(next);
    setLastEvent("Sync disconnected.");
  }, []);

  const syncNow = useCallback(async () => {
    await runSync(true, "manual");
  }, [runSync]);

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
      syncStatus,
      lastEvent,
      unlock,
      createItem,
      updateItem,
      deleteItem,
      updateAutoLockMinutes,
      completeSyncCallback,
      syncSignIn,
      syncSignOut,
      syncNow,
      copyValue,
    }),
    [
      completeSyncCallback,
      copyValue,
      createItem,
      deleteItem,
      lastEvent,
      loading,
      locked,
      settings,
      syncNow,
      syncSignIn,
      syncSignOut,
      syncStatus,
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
