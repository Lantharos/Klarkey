import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { Encoder } from 'cbor-x'
import { decodeBase64Url, encodeBase64Url } from '@/shared/passkey-encoding'

type BrowserCredentialDescriptor = {
  id?: string
  type?: 'public-key'
  transports?: string[]
}

type BrowserCreationOptions = {
  challenge?: string
  rp?: {
    id?: string
    name?: string
  }
  user?: {
    id?: string
    name?: string
    displayName?: string
  }
  pubKeyCredParams?: Array<{
    type?: string
    alg?: number
  }>
  authenticatorSelection?: {
    residentKey?: 'discouraged' | 'preferred' | 'required'
    requireResidentKey?: boolean
  }
  extensions?: {
    credProps?: boolean
  }
  excludeCredentials?: BrowserCredentialDescriptor[]
}

type BrowserRequestOptions = {
  challenge?: string
  rpId?: string
  allowCredentials?: BrowserCredentialDescriptor[]
}

type StoredSitePasskey = {
  credentialId: string
  rpId: string
  userHandle?: string
  signCount: number
  privateKeyJwk: JsonWebKey
}

type WebAuthnCredentialResponse = {
  id: string
  rawId: string
  type: 'public-key'
  authenticatorAttachment: 'platform'
  clientExtensionResults: Record<string, unknown>
  response: Record<string, unknown>
}

type CreateSitePasskeyInput = {
  origin: string
  requestDetailsJson: string
  existingCredentialIds?: string[]
}

type GetSitePasskeyInput = {
  origin: string
  requestDetailsJson: string
  passkey: StoredSitePasskey
}

const AAGUID = new Uint8Array(16)
const AUTH_DATA_UP = 0x01
const AUTH_DATA_UV = 0x04
const AUTH_DATA_AT = 0x40
const cborEncoder = new Encoder({ structuredClone: false })

const asUtf8 = (value: string) => new TextEncoder().encode(value)
const asUint8Array = (value: Uint8Array | ArrayBuffer) => (value instanceof Uint8Array ? value : new Uint8Array(value))
const sha256 = (value: Uint8Array | ArrayBuffer) => createHash('sha256').update(asUint8Array(value)).digest()

const uint16Bytes = (value: number) => {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, false)
  return bytes
}

const uint32Bytes = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

const joinBytes = (...parts: Array<Uint8Array | Buffer>) => {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return Buffer.from(output)
}

const decodeRequiredBase64Url = (value: string | undefined, message: string) => {
  if (!value?.trim()) {
    throw new Error(message)
  }

  return decodeBase64Url(value)
}

const parseCreationOptions = (requestDetailsJson: string) => JSON.parse(requestDetailsJson) as BrowserCreationOptions
const parseRequestOptions = (requestDetailsJson: string) => JSON.parse(requestDetailsJson) as BrowserRequestOptions

const resolveRpId = (origin: string, requestedRpId?: string) => {
  const hostname = new URL(origin).hostname
  return (requestedRpId?.trim() || hostname).toLowerCase()
}

const validateEs256Support = (options: BrowserCreationOptions) => {
  const supportsEs256 = (options.pubKeyCredParams ?? []).some(
    (entry) => entry?.type === 'public-key' && entry?.alg === -7,
  )

  if (!supportsEs256) {
    throw new Error('This site does not allow ES256 passkeys, so Klarkey cannot create one here yet.')
  }
}

const buildCosePublicKey = (jwk: JsonWebKey) => {
  const x = Buffer.from(decodeRequiredBase64Url(jwk.x, 'The generated passkey is missing its public key.'))
  const y = Buffer.from(decodeRequiredBase64Url(jwk.y, 'The generated passkey is missing its public key.'))
  const coseKey = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ])

  return Buffer.from(cborEncoder.encode(coseKey))
}

const exportSpkiPublicKey = (publicKey: KeyObject) =>
  new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }))

const buildClientDataJson = (type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string) =>
  asUtf8(
    JSON.stringify({
      type,
      challenge: encodeBase64Url(challenge),
      origin,
      crossOrigin: false,
    }),
  )

const buildClientExtensionResults = (options: BrowserCreationOptions) => {
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

const buildAuthenticatorData = ({
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

const serializeCreateResponse = ({
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

const serializeGetResponse = ({
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

export const createSitePasskeyCredential = ({ origin, requestDetailsJson, existingCredentialIds = [] }: CreateSitePasskeyInput) => {
  const options = parseCreationOptions(requestDetailsJson)
  validateEs256Support(options)

  const excludedCredentialIds = new Set(
    (options.excludeCredentials ?? [])
      .map((descriptor) => descriptor.id?.trim())
      .filter((credentialId): credentialId is string => Boolean(credentialId)),
  )

  const duplicateCredentialId = existingCredentialIds.find((credentialId) => excludedCredentialIds.has(credentialId))
  if (duplicateCredentialId) {
    throw new Error('This site asked Klarkey not to reuse an existing passkey for this account.')
  }

  const challenge = decodeRequiredBase64Url(options.challenge, 'The site did not provide a passkey challenge.')
  const userHandle = decodeRequiredBase64Url(options.user?.id, 'The site did not provide a passkey user id.')
  const rpId = resolveRpId(origin, options.rp?.id)
  const credentialId = randomBytes(32)
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
  const privateKeyJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey
  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
  const publicKeyCose = buildCosePublicKey(publicKeyJwk)
  const publicKeySpki = exportSpkiPublicKey(publicKey as KeyObject)
  const authenticatorData = buildAuthenticatorData({
    rpId,
    flags: AUTH_DATA_UP | AUTH_DATA_UV | AUTH_DATA_AT,
    signCount: 0,
    credentialId,
    publicKey: publicKeyCose,
  })
  const attestationObject = Buffer.from(
    cborEncoder.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', Buffer.from(authenticatorData)],
      ]),
    ),
  )
  const clientDataJSON = buildClientDataJson('webauthn.create', challenge, origin)
  const clientExtensionResults = buildClientExtensionResults(options)

  return {
    credentialId: encodeBase64Url(credentialId),
    rpId,
    userHandle: encodeBase64Url(userHandle),
    privateKeyJwk,
    responseJson: JSON.stringify(
      serializeCreateResponse({
        credentialId,
        clientDataJSON,
        attestationObject,
        authenticatorData,
        publicKey: publicKeySpki,
        clientExtensionResults,
      }),
    ),
  }
}

export const getSitePasskeyAssertion = ({ origin, requestDetailsJson, passkey }: GetSitePasskeyInput) => {
  const options = parseRequestOptions(requestDetailsJson)
  const challenge = decodeRequiredBase64Url(options.challenge, 'The site did not provide a passkey challenge.')
  const rpId = resolveRpId(origin, options.rpId)
  const clientDataJSON = buildClientDataJson('webauthn.get', challenge, origin)
  const nextSignCount = passkey.signCount + 1
  const authenticatorData = buildAuthenticatorData({
    rpId,
    flags: AUTH_DATA_UP | AUTH_DATA_UV,
    signCount: nextSignCount,
  })
  const signatureBase = joinBytes(authenticatorData, sha256(clientDataJSON))
  const signature = sign('sha256', signatureBase, createPrivateKey({ format: 'jwk', key: passkey.privateKeyJwk }))
  const userHandle = passkey.userHandle ? decodeBase64Url(passkey.userHandle) : undefined

  return {
    credentialId: passkey.credentialId,
    signCount: nextSignCount,
    responseJson: JSON.stringify(
      serializeGetResponse({
        credentialId: passkey.credentialId,
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle,
      }),
    ),
  }
}
