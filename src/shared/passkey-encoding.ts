const toBase64 = (bytes: Uint8Array) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const fromBase64 = (value: string) => {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  }

  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export const encodeBase64Url = (input: ArrayBuffer | Uint8Array) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const decodeBase64Url = (input: string) => {
  const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return fromBase64(padded)
}

const isByteArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)

const asObject = (value: unknown) => (typeof value === 'object' && value ? (value as Record<string, unknown>) : undefined)

export const normalizeCredentialId = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      return encodeBase64Url(decodeBase64Url(trimmed))
    } catch {
      return trimmed
    }
  }

  if (value instanceof Uint8Array) {
    return encodeBase64Url(value)
  }

  if (value instanceof ArrayBuffer) {
    return encodeBase64Url(value)
  }

  if (isByteArray(value)) {
    return encodeBase64Url(Uint8Array.from(value))
  }

  const objectValue = asObject(value)
  if (!objectValue) {
    return undefined
  }

  if (typeof objectValue.buffer === 'string') {
    return normalizeCredentialId(objectValue.buffer)
  }

  if (isByteArray(objectValue.data)) {
    return normalizeCredentialId(objectValue.data)
  }

  if (typeof objectValue.id === 'string') {
    return normalizeCredentialId(objectValue.id)
  }

  return undefined
}
