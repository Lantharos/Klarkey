type MobileSyncItemKind = "login" | "identity" | "card" | "note" | "ssh-key";

export const syncSchemaVersion = 1;
export const syncKeyAlgorithm = "AES-256-GCM";
export const syncKeyDerivation = "HKDF-SHA256-klarkey-sync-v1";

export type PlainMobileRecord =
  | {
      kind: "item";
      recordId: string;
      itemId: string;
      itemType: MobileSyncItemKind;
      item: Record<string, unknown> & { itemId: string; itemType: MobileSyncItemKind; itemName: string; username?: string };
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

export type EncryptedRecord = {
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

export type WrappedVaultKey = {
  iv: string;
  ciphertext: string;
  authTag: string;
  algorithm: "AES-256-GCM";
  derivation: "HKDF-SHA256-klarkey-sync-v1";
  wrappedAt: number;
};

export type PushAccepted = {
  recordId: string;
  revision: number;
  serverSequence: number;
  contentHash: string;
};

export type BootstrapResponse = {
  wrappedVaultKey?: WrappedVaultKey;
  schemaVersion: typeof syncSchemaVersion;
  sequence: number;
  needsSetup: boolean;
};

export type RemoteSyncStatus = {
  syncAllowed: boolean;
  sequence: number;
  schemaVersion: typeof syncSchemaVersion;
  hasVaultKey: boolean;
};

const maxIdLength = 160;
const maxLabelLength = 256;
const maxSmallTextLength = 4096;
const maxLargeTextLength = 100_000;
const maxUrlLength = 2048;
const maxEnvelopeFieldLength = 2048;
const maxCiphertextBytes = 256 * 1024;
const maxCiphertextLength = Math.ceil(maxCiphertextBytes / 3) * 4 + 4;
const maxHashLength = 128;
const maxPullRecords = 500;
const maxPushBatchRecords = 100;
const maxArrayItems = 128;
const maxCustomFields = 64;
const gcmIvBytes = 12;
const gcmAuthTagBytes = 16;
const sha256Bytes = 32;
const wrappedVaultKeyBytes = 32;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const itemStringFields = new Map<string, number>([
  ["username", maxSmallTextLength],
  ["password", maxLargeTextLength],
  ["otp", maxLargeTextLength],
  ["otpCode", maxLargeTextLength],
  ["fullName", maxSmallTextLength],
  ["firstName", maxSmallTextLength],
  ["middleName", maxSmallTextLength],
  ["lastName", maxSmallTextLength],
  ["company", maxSmallTextLength],
  ["jobTitle", maxSmallTextLength],
  ["birthDate", maxSmallTextLength],
  ["email", maxSmallTextLength],
  ["phone", maxSmallTextLength],
  ["address", maxSmallTextLength],
  ["addressLine1", maxSmallTextLength],
  ["addressLine2", maxSmallTextLength],
  ["city", maxSmallTextLength],
  ["state", maxSmallTextLength],
  ["postalCode", maxSmallTextLength],
  ["country", maxSmallTextLength],
  ["cardholderName", maxSmallTextLength],
  ["cardNumber", maxSmallTextLength],
  ["cardLastFour", maxSmallTextLength],
  ["cardExpiry", maxSmallTextLength],
  ["cardExpiryMonth", maxSmallTextLength],
  ["cardExpiryYear", maxSmallTextLength],
  ["cardCvc", maxSmallTextLength],
  ["cardBrand", maxSmallTextLength],
  ["billingPostalCode", maxSmallTextLength],
  ["sshAlgorithm", maxSmallTextLength],
  ["sshFingerprint", maxSmallTextLength],
  ["sshPublicKey", maxLargeTextLength],
  ["sshPrivateKey", maxLargeTextLength],
  ["sshComment", maxSmallTextLength],
  ["content", maxLargeTextLength],
  ["notes", maxLargeTextLength],
  ["ssoProvider", maxSmallTextLength],
]);

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isString(value: unknown, maxLength = maxSmallTextLength, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0) && !value.includes("\0");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodedBase64ByteLength(value: string) {
  if (!value || value.length % 4 !== 0 || !base64Pattern.test(value)) {
    return undefined;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isBase64ByteLengthInRange(value: unknown, minBytes: number, maxBytes: number) {
  if (typeof value !== "string") {
    return false;
  }
  const length = decodedBase64ByteLength(value);
  return length !== undefined && length >= minBytes && length <= maxBytes;
}

function isSafeIntegerInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isP256Coordinate(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    return false;
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded).length === 32;
  } catch {
    return false;
  }
}

function isOptionalString(value: unknown, maxLength = maxSmallTextLength) {
  return value === undefined || isString(value, maxLength, true);
}

function isOptionalDeletedAt(value: unknown) {
  return value === undefined || isSafeIntegerInRange(value, 1);
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((entry) => isString(entry, maxLength, true));
}

function isMobileItemKind(value: unknown): value is MobileSyncItemKind {
  return value === "login" || value === "identity" || value === "card" || value === "note" || value === "ssh-key";
}

function isPrivateKeyJwk(value: unknown) {
  if (value === undefined) {
    return true;
  }
  const jwk = objectRecord(value);
  return Boolean(
    jwk &&
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    isP256Coordinate(jwk.x) &&
    isP256Coordinate(jwk.y) &&
    isP256Coordinate(jwk.d),
  );
}

function hasValidCustomFields(value: unknown) {
  return value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxCustomFields &&
      value.every((field) => {
        const customField = objectRecord(field);
        return Boolean(
          customField &&
          isString(customField.id, maxIdLength) &&
          isString(customField.label, maxLabelLength, true) &&
          isString(customField.value, maxLargeTextLength, true),
        );
      }));
}

function hasValidItemPayload(item: Record<string, unknown>, itemId: string, itemType: MobileSyncItemKind) {
  if (item.itemId !== itemId || item.itemType !== itemType || !isString(item.itemName, maxLabelLength)) {
    return false;
  }

  for (const [field, maxLength] of itemStringFields.entries()) {
    if (!isOptionalString(item[field], maxLength)) {
      return false;
    }
  }

  return (item.websites === undefined || isStringArray(item.websites, 32, maxUrlLength)) &&
    (item.recoveryCodes === undefined || isStringArray(item.recoveryCodes, maxArrayItems, maxSmallTextLength)) &&
    hasValidCustomFields(item.customFields);
}

export function isPlainMobileRecord(value: unknown): value is PlainMobileRecord {
  const record = objectRecord(value);
  if (!record || !isString(record.recordId, maxIdLength) || !isOptionalDeletedAt(record.deletedAt)) {
    return false;
  }

  if (record.kind === "item") {
    const item = objectRecord(record.item);
    return Boolean(
      isString(record.itemId, maxIdLength) &&
      record.recordId === `item:${record.itemId}` &&
      isMobileItemKind(record.itemType) &&
      item &&
      hasValidItemPayload(item, record.itemId, record.itemType as MobileSyncItemKind) &&
      isString(record.updatedAt, maxSmallTextLength),
    );
  }

  if (record.kind === "site-passkey") {
    return Boolean(
      isString(record.passkeyId, maxIdLength) &&
      isString(record.itemId, maxIdLength) &&
      isString(record.credentialId, maxSmallTextLength) &&
      record.recordId === `site-passkey:${record.credentialId}` &&
      isString(record.label, maxLabelLength) &&
      isOptionalString(record.rpId, 253) &&
      isOptionalString(record.userName, maxSmallTextLength) &&
      isOptionalString(record.userHandle, maxSmallTextLength) &&
      isStringArray(record.transports, 16, 32) &&
      isPrivateKeyJwk(record.privateKeyJwk) &&
      isFiniteNumber(record.signCount) && record.signCount >= 0 &&
      isString(record.createdAt, maxSmallTextLength) &&
      isOptionalString(record.lastUsedAt, maxSmallTextLength) &&
      record.syncedCounter === true,
    );
  }

  return Boolean(
    record.kind === "settings" &&
    record.recordId === "settings:user" &&
    objectRecord(record.settings) &&
    isString(record.updatedAt, maxSmallTextLength),
  );
}

function isWrappedVaultKey(value: unknown): value is WrappedVaultKey {
  const wrapped = objectRecord(value);
  return Boolean(
    wrapped &&
    isString(wrapped.iv, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.iv, gcmIvBytes, gcmIvBytes) &&
    isString(wrapped.ciphertext, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.ciphertext, wrappedVaultKeyBytes, wrappedVaultKeyBytes) &&
    isString(wrapped.authTag, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.authTag, gcmAuthTagBytes, gcmAuthTagBytes) &&
    wrapped.algorithm === syncKeyAlgorithm &&
    wrapped.derivation === syncKeyDerivation &&
    isSafeIntegerInRange(wrapped.wrappedAt, 0),
  );
}

export function normalizeWrappedVaultKey(value: unknown): WrappedVaultKey {
  if (!isWrappedVaultKey(value)) {
    throw new Error("Invalid Klarkey sync key envelope.");
  }

  return value;
}

export function normalizeBootstrapResponse(value: unknown): BootstrapResponse {
  const response = objectRecord(value);
  const wrappedVaultKey = response?.wrappedVaultKey;
  if (
    !response ||
    response.schemaVersion !== syncSchemaVersion ||
    !isSafeIntegerInRange(response.sequence, 0) ||
    typeof response.needsSetup !== "boolean"
  ) {
    throw new Error("Invalid Klarkey sync bootstrap response.");
  }
  if (wrappedVaultKey !== undefined && !isWrappedVaultKey(wrappedVaultKey)) {
    throw new Error("Invalid Klarkey sync key envelope.");
  }

  return {
    wrappedVaultKey: wrappedVaultKey === undefined ? undefined : normalizeWrappedVaultKey(wrappedVaultKey),
    schemaVersion: syncSchemaVersion,
    sequence: response.sequence,
    needsSetup: response.needsSetup,
  };
}

function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  const record = objectRecord(value);
  return Boolean(
    record &&
    isString(record.recordId, maxIdLength) &&
    isSafeIntegerInRange(record.revision, 1) &&
    isSafeIntegerInRange(record.serverSequence, 0) &&
    isString(record.deviceId, 120) &&
    isOptionalDeletedAt(record.deletedAt) &&
    isString(record.ciphertext, maxCiphertextLength) &&
    isBase64ByteLengthInRange(record.ciphertext, 1, maxCiphertextBytes) &&
    isString(record.iv, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(record.iv, gcmIvBytes, gcmIvBytes) &&
    isString(record.authTag, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(record.authTag, gcmAuthTagBytes, gcmAuthTagBytes) &&
    isString(record.contentHash, maxHashLength) &&
    isBase64ByteLengthInRange(record.contentHash, sha256Bytes, sha256Bytes) &&
    record.schemaVersion === syncSchemaVersion,
  );
}

export function normalizePullResponse(value: unknown): { wrappedVaultKey?: WrappedVaultKey; schemaVersion: typeof syncSchemaVersion; sequence: number; records: EncryptedRecord[] } {
  const response = objectRecord(value);
  const wrappedVaultKey = response?.wrappedVaultKey;
  const records = response?.records;
  if (
    !response ||
    response.schemaVersion !== syncSchemaVersion ||
    !isSafeIntegerInRange(response.sequence, 0) ||
    !Array.isArray(records) ||
    records.length > maxPullRecords
  ) {
    throw new Error("Invalid Klarkey sync pull response.");
  }
  if (wrappedVaultKey !== undefined && !isWrappedVaultKey(wrappedVaultKey)) {
    throw new Error("Invalid Klarkey sync key envelope.");
  }
  if (!records.every(isEncryptedRecord)) {
    throw new Error("Invalid Klarkey sync record envelope.");
  }
  return {
    wrappedVaultKey: wrappedVaultKey === undefined ? undefined : normalizeWrappedVaultKey(wrappedVaultKey),
    schemaVersion: syncSchemaVersion,
    sequence: response.sequence,
    records,
  };
}

function isPushAccepted(value: unknown): value is PushAccepted {
  const accepted = objectRecord(value);
  return Boolean(
    accepted &&
    isString(accepted.recordId, maxIdLength) &&
    isSafeIntegerInRange(accepted.revision, 1) &&
    isSafeIntegerInRange(accepted.serverSequence, 0) &&
    isString(accepted.contentHash, maxHashLength) &&
    isBase64ByteLengthInRange(accepted.contentHash, sha256Bytes, sha256Bytes),
  );
}

export function normalizePushBatchResponse(value: unknown): { sequence: number; accepted: PushAccepted[]; conflicts: EncryptedRecord[] } {
  const response = objectRecord(value);
  const accepted = response?.accepted;
  const conflicts = response?.conflicts;
  if (
    !response ||
    !isSafeIntegerInRange(response.sequence, 0) ||
    !Array.isArray(accepted) ||
    !Array.isArray(conflicts) ||
    accepted.length > maxPushBatchRecords ||
    conflicts.length > maxPushBatchRecords
  ) {
    throw new Error("Invalid Klarkey sync push response.");
  }
  if (!accepted.every(isPushAccepted) || !conflicts.every(isEncryptedRecord)) {
    throw new Error("Invalid Klarkey sync push records.");
  }
  return {
    sequence: response.sequence,
    accepted,
    conflicts,
  };
}

export function normalizeRemoteSyncStatus(value: unknown): RemoteSyncStatus {
  const response = objectRecord(value);
  if (
    !response ||
    typeof response.syncAllowed !== "boolean" ||
    !isSafeIntegerInRange(response.sequence, 0) ||
    response.schemaVersion !== syncSchemaVersion ||
    typeof response.hasVaultKey !== "boolean"
  ) {
    throw new Error("Invalid Klarkey sync status response.");
  }

  return {
    syncAllowed: response.syncAllowed,
    sequence: response.sequence,
    schemaVersion: syncSchemaVersion,
    hasVaultKey: response.hasVaultKey,
  };
}
