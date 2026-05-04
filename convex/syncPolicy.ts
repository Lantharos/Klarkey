export type RecordVersionState = {
  revision: number;
  contentHash: string;
};

export type RecordWriteDecision = "accept-existing" | "conflict-existing" | "reject-new-revision" | "write-incoming";

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const syncRecordIdFragmentPattern = /^[A-Za-z0-9_-]+$/;

export function decideRecordWrite(existing: RecordVersionState | undefined, incoming: RecordVersionState): RecordWriteDecision {
  if (!existing) {
    return incoming.revision === 1 ? "write-incoming" : "reject-new-revision";
  }

  if (existing.contentHash === incoming.contentHash) {
    return "accept-existing";
  }

  if (incoming.revision > existing.revision + 1 || existing.revision >= incoming.revision) {
    return "conflict-existing";
  }

  return "write-incoming";
}

export function decodedBase64ByteLength(value: string) {
  if (!value || value.length % 4 !== 0 || !base64Pattern.test(value)) {
    return undefined;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function isBase64ByteLengthInRange(value: string, minBytes: number, maxBytes: number) {
  const length = decodedBase64ByteLength(value);
  return length !== undefined && length >= minBytes && length <= maxBytes;
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

export function isSafeSyncText(value: string, maxLength: number) {
  return Boolean(value) &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacter(value);
}

export function canRegisterNewDevice(existingDeviceCount: number, maxDevices: number) {
  return Number.isSafeInteger(existingDeviceCount) &&
    Number.isSafeInteger(maxDevices) &&
    maxDevices > 0 &&
    existingDeviceCount >= 0 &&
    existingDeviceCount < maxDevices;
}

export function isExpectedSyncRecordId(recordId: string) {
  const hasValidFragment = (prefix: string) => {
    if (!recordId.startsWith(prefix) || recordId.length <= prefix.length) {
      return false;
    }

    return syncRecordIdFragmentPattern.test(recordId.slice(prefix.length));
  };

  return recordId === "settings:user" ||
    hasValidFragment("item:") ||
    hasValidFragment("site-passkey:");
}
