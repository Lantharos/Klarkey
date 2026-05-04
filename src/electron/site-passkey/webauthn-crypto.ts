import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { Encoder } from 'cbor-x'
import { getPublicSuffix, parse } from 'tldts'
import { decodeBase64Url, encodeBase64Url } from '@/shared/passkey-encoding'
import type { BrowserCreationOptions, BrowserRequestOptions, WebAuthnCredentialResponse } from '@/electron/site-passkey/types'

export const AAGUID = new Uint8Array(16)
export const AUTH_DATA_UP = 0x01
export const AUTH_DATA_UV = 0x04
export const AUTH_DATA_BE = 0x08
export const AUTH_DATA_BS = 0x10
export const AUTH_DATA_AT = 0x40
export const cborEncoder = new Encoder({ structuredClone: false })

const asUtf8 = (value: string) => new TextEncoder().encode(value)
const asUint8Array = (value: Uint8Array | ArrayBuffer) => (value instanceof Uint8Array ? value : new Uint8Array(value))
export const sha256 = (value: Uint8Array | ArrayBuffer) => createHash('sha256').update(asUint8Array(value)).digest()

export const uint16Bytes = (value: number) => {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, false)
  return bytes
}

export const uint32Bytes = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

export const joinBytes = (...parts: Array<Uint8Array | Buffer>) => {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return Buffer.from(output)
}

export const decodeRequiredBase64Url = (
  value: string | undefined,
  message: string,
  bounds: { minBytes?: number; maxBytes?: number; exactBytes?: number } = {},
) => {
  if (!value?.trim()) {
    throw new Error(message)
  }

  const decoded = decodeBase64Url(value)
  const minBytes = bounds.exactBytes ?? bounds.minBytes ?? 1
  const maxBytes = bounds.exactBytes ?? bounds.maxBytes ?? Number.MAX_SAFE_INTEGER
  if (decoded.length < minBytes || decoded.length > maxBytes) {
    throw new Error(message)
  }
  return decoded
}

export const parseCreationOptions = (requestDetailsJson: string) => JSON.parse(requestDetailsJson) as BrowserCreationOptions
export const parseRequestOptions = (requestDetailsJson: string) => JSON.parse(requestDetailsJson) as BrowserRequestOptions

const tldOptions = { allowPrivateDomains: true, extractHostname: false } as const

const isLocalOrIpHost = (hostname: string) => hostname === 'localhost' || parse(hostname, tldOptions).isIp

export const resolveRpId = (origin: string, requestedRpId?: string) => {
  const hostname = new URL(origin).hostname
  const rpId = (requestedRpId?.trim() || hostname).toLowerCase().replace(/\.$/, '')
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')

  if (!/^[a-z0-9.-]+$/.test(rpId) || rpId.includes('..') || rpId.startsWith('.') || rpId.endsWith('.')) {
    throw new Error('The site requested an invalid passkey relying party id.')
  }

  const publicSuffix = getPublicSuffix(rpId, tldOptions)
  if (!isLocalOrIpHost(rpId) && (!publicSuffix || publicSuffix === rpId)) {
    throw new Error('The site requested a public suffix as its passkey relying party id.')
  }

  if (rpId !== normalizedHostname && !normalizedHostname.endsWith(`.${rpId}`)) {
    throw new Error('The passkey relying party id does not match this site.')
  }

  return rpId
}

export const validateEs256Support = (options: BrowserCreationOptions) => {
  const supportsEs256 = (options.pubKeyCredParams ?? []).some(
    (entry) => entry?.type === 'public-key' && entry?.alg === -7,
  )

  if (!supportsEs256) {
    throw new Error('This site does not allow ES256 passkeys, so Klarkey cannot create one here yet.')
  }
}

export const buildCosePublicKey = (jwk: JsonWebKey) => {
  const x = Buffer.from(decodeRequiredBase64Url(jwk.x, 'The generated passkey is missing its public key.', { exactBytes: 32 }))
  const y = Buffer.from(decodeRequiredBase64Url(jwk.y, 'The generated passkey is missing its public key.', { exactBytes: 32 }))
  const coseKey = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ])

  return Buffer.from(cborEncoder.encode(coseKey))
}

export const exportSpkiPublicKey = (publicKey: KeyObject) => new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }))

export const buildClientDataJson = (type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string) =>
  asUtf8(
    JSON.stringify({
      type,
      challenge: encodeBase64Url(challenge),
      origin,
      crossOrigin: false,
    }),
  )

export const buildClientExtensionResults = (options: BrowserCreationOptions) => {
  if (!options.extensions?.credProps) {
    return {}
  }

  const residentKey = options.authenticatorSelection?.residentKey
  const rk = residentKey === 'required' || residentKey === 'preferred' || options.authenticatorSelection?.requireResidentKey === true
  return {
    credProps: {
      rk,
    },
  }
}

export const shouldUsePackedAttestation = (options: BrowserCreationOptions) => {
  const preference = options.attestation?.trim().toLowerCase()
  return preference === 'direct' || preference === 'indirect' || preference === 'enterprise'
}

export const buildPackedSelfAttestationStatement = ({
  authenticatorData,
  clientDataJSON,
  privateKeyJwk,
}: {
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
  privateKeyJwk: JsonWebKey
}) => {
  const clientDataHash = sha256(clientDataJSON)
  const signatureBase = joinBytes(authenticatorData, clientDataHash)
  const sig = sign('sha256', signatureBase, createPrivateKey({ format: 'jwk', key: privateKeyJwk }))

  return new Map<string, unknown>([
    ['alg', -7],
    ['sig', Buffer.from(sig)],
  ])
}

export const buildAuthenticatorData = ({
  rpId,
  flags,
  signCount,
  credentialId,
  publicKey,
}: {
  rpId: string
  flags: number
  signCount: number
  credentialId?: Uint8Array
  publicKey?: Uint8Array
}) => {
  const rpIdHash = sha256(asUtf8(rpId))
  const header = joinBytes(rpIdHash, Uint8Array.of(flags), uint32Bytes(signCount))

  if (!credentialId || !publicKey) {
    return Buffer.from(header)
  }

  return Buffer.from(joinBytes(header, AAGUID, uint16Bytes(credentialId.length), credentialId, publicKey))
}

export const serializeCreateResponse = ({
  credentialId,
  clientDataJSON,
  attestationObject,
  authenticatorData,
  publicKey,
  clientExtensionResults,
}: {
  credentialId: Uint8Array
  clientDataJSON: Uint8Array
  attestationObject: Uint8Array
  authenticatorData: Uint8Array
  publicKey: Uint8Array
  clientExtensionResults: Record<string, unknown>
}): WebAuthnCredentialResponse => {
  const encodedCredentialId = encodeBase64Url(credentialId)
  return {
    id: encodedCredentialId,
    rawId: encodedCredentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults,
    response: {
      clientDataJSON: encodeBase64Url(clientDataJSON),
      attestationObject: encodeBase64Url(attestationObject),
      authenticatorData: encodeBase64Url(authenticatorData),
      publicKey: encodeBase64Url(publicKey),
      publicKeyAlgorithm: -7,
      transports: ['internal'],
    },
  }
}

export const serializeGetResponse = ({
  credentialId,
  clientDataJSON,
  authenticatorData,
  signature,
  userHandle,
}: {
  credentialId: string
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
  userHandle?: Uint8Array
}): WebAuthnCredentialResponse => ({
  id: credentialId,
  rawId: credentialId,
  type: 'public-key',
  authenticatorAttachment: 'platform',
  clientExtensionResults: {},
  response: {
    clientDataJSON: encodeBase64Url(clientDataJSON),
    authenticatorData: encodeBase64Url(authenticatorData),
    signature: encodeBase64Url(signature),
    userHandle: userHandle ? encodeBase64Url(userHandle) : null,
  },
})
