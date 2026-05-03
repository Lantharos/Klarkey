function numericObjectToBytes(value: Record<string, unknown>) {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([key, byte]) => !/^\d+$/.test(key) || typeof byte !== "number")) {
    return undefined;
  }
  return Uint8Array.from(
    entries
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, byte]) => byte as number),
  );
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function binaryToBytes(value: unknown) {
  if (typeof value === "string") {
    return base64ToBytes(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value && typeof value === "object") {
    const bytes = numericObjectToBytes(value as Record<string, unknown>);
    if (bytes) {
      return bytes;
    }
  }
  throw new Error("AES output could not be encoded.");
}

export function binaryToBase64(value: unknown) {
  return typeof value === "string" ? value : bytesToBase64(binaryToBytes(value));
}
