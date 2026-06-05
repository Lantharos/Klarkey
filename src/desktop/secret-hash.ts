type SecretHashRecord = {
  version: 2
  algorithm: 'PBKDF2-SHA-256'
  salt: string
  iterations: number
  hash: string
}

export type StoredSecretHash = string | SecretHashRecord

const textEncoder = new TextEncoder()
const iterations = 310_000
const minimumIterations = 100_000
const maximumIterations = 1_000_000

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
const equalBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

const equalStrings = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function pbkdf2(secret: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), 'PBKDF2', false, ['deriveBits'])
  const saltBytes = salt.slice()
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes.buffer, iterations: rounds }, key, 256)
  return new Uint8Array(bits)
}

export async function createSecretHash(secret: string): Promise<SecretHashRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  return {
    version: 2,
    algorithm: 'PBKDF2-SHA-256',
    salt: toBase64(salt),
    iterations,
    hash: toBase64(await pbkdf2(secret, salt, iterations)),
  }
}

export async function verifySecretHash(secret: string, stored: StoredSecretHash | undefined) {
  if (!stored) return false
  if (typeof stored === 'string') return equalStrings(await sha256(secret), stored)
  if (stored.version !== 2 || stored.algorithm !== 'PBKDF2-SHA-256') return false
  if (!Number.isSafeInteger(stored.iterations) || stored.iterations < minimumIterations || stored.iterations > maximumIterations) return false
  try {
    return equalBytes(await pbkdf2(secret, fromBase64(stored.salt), stored.iterations), fromBase64(stored.hash))
  } catch {
    return false
  }
}

export const shouldUpgradeSecretHash = (stored: StoredSecretHash | undefined) => typeof stored === 'string'
