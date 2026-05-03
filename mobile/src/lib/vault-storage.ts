import * as Crypto from "expo-crypto";
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import { binaryToBase64, binaryToBytes, bytesToBase64 } from "@/lib/binary-encoding";
import type { MobilePasskey, MobileVaultItem, MobileVaultState } from "@/lib/vault";

type VaultRecordKind = "item" | "passkey";

interface VaultRow {
  id: string;
  kind: VaultRecordKind;
  payload: string;
}

interface EncryptedVaultPayload {
  iv: string;
  ciphertext: string;
  authTag: string;
}

const databaseName = "klarkey-mobile-vault.db";
const vaultKey = "klarkey.mobile.vault.v1";
const localKey = "klarkey.mobile.local-key.v1";
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function persistedId(value: unknown, prefix: VaultRecordKind) {
  return typeof value === "string" && value.trim() ? value.trim() : `${prefix}_${Crypto.randomUUID()}`;
}

async function database() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(databaseName).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS vault_records (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

async function encryptionKey() {
  const stored = await SecureStore.getItemAsync(localKey, secureOptions);
  if (stored) {
    return AESEncryptionKey.import(stored, "base64");
  }

  const keyBytes = Crypto.getRandomBytes(32);
  const encoded = bytesToBase64(keyBytes);
  await SecureStore.setItemAsync(localKey, encoded, secureOptions);
  return AESEncryptionKey.import(encoded, "base64");
}

async function encryptRecord(recordId: string, value: unknown): Promise<string> {
  const key = await encryptionKey();
  const sealed = await aesEncryptAsync(textToBytes(JSON.stringify(value)), key, {
    additionalData: textToBytes(recordId),
  });
  const payload: EncryptedVaultPayload = {
    iv: binaryToBase64(await sealed.iv("base64")),
    ciphertext: binaryToBase64(await sealed.ciphertext({ encoding: "base64" })),
    authTag: binaryToBase64(await sealed.tag("base64")),
  };
  return JSON.stringify(payload);
}

async function decryptRecord<T>(recordId: string, payload: string): Promise<T | undefined> {
  try {
    const parsed = JSON.parse(payload) as EncryptedVaultPayload;
    const sealed = AESSealedData.fromParts(
      binaryToBytes(parsed.iv),
      binaryToBytes(parsed.ciphertext),
      binaryToBytes(parsed.authTag),
    );
    const decrypted = await aesDecryptAsync(sealed, await encryptionKey(), {
      additionalData: textToBytes(recordId),
    });
    return JSON.parse(bytesToText(decrypted as Uint8Array)) as T;
  } catch {
    return undefined;
  }
}

export async function loadStoredVaultState(): Promise<Partial<MobileVaultState> | undefined> {
  const db = await database();
  const rows = await db.getAllAsync<VaultRow>("SELECT id, kind, payload FROM vault_records ORDER BY updatedAt DESC");
  if (rows.length === 0) {
    return await migrateLegacyVault();
  }

  const items: MobileVaultItem[] = [];
  const passkeys: MobilePasskey[] = [];

  for (const row of rows) {
    if (row.kind === "item") {
      const item = await decryptRecord<MobileVaultItem>(row.id, row.payload);
      if (item) {
        items.push(item);
      }
    } else {
      const passkey = await decryptRecord<MobilePasskey>(row.id, row.payload);
      if (passkey) {
        passkeys.push(passkey);
      }
    }
  }

  return { items, passkeys };
}

export async function saveStoredVaultState(state: MobileVaultState) {
  const db = await database();
  const timestamp = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM vault_records");
    for (const item of state.items) {
      const recordId = persistedId((item as Partial<MobileVaultItem>).id, "item");
      const payload = recordId === item.id ? item : { ...item, id: recordId };
      await db.runAsync(
        "INSERT INTO vault_records(id, kind, payload, updatedAt) VALUES (?, ?, ?, ?)",
        recordId,
        "item",
        await encryptRecord(recordId, payload),
        timestamp,
      );
    }
    for (const passkey of state.passkeys) {
      const recordId = persistedId((passkey as Partial<MobilePasskey>).id, "passkey");
      const payload = recordId === passkey.id ? passkey : { ...passkey, id: recordId };
      await db.runAsync(
        "INSERT INTO vault_records(id, kind, payload, updatedAt) VALUES (?, ?, ?, ?)",
        recordId,
        "passkey",
        await encryptRecord(recordId, payload),
        timestamp,
      );
    }
  });
}

async function migrateLegacyVault(): Promise<Partial<MobileVaultState> | undefined> {
  const stored = await SecureStore.getItemAsync(vaultKey, secureOptions);
  if (!stored) {
    return undefined;
  }

  const parsed = JSON.parse(stored) as Partial<MobileVaultState>;
  await saveStoredVaultState({
    items: parsed.items ?? [],
    passkeys: parsed.passkeys ?? [],
  });
  return parsed;
}
