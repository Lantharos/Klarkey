import { generateKeyPairSync, randomBytes, sign, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { decodeBase64Url, encodeBase64Url, normalizeCredentialId } from '@/shared/passkey-encoding'
import type { CreateSitePasskeyInput, GetSitePasskeyInput } from '@/electron/site-passkey/types'
import {
  AUTH_DATA_AT,
  AUTH_DATA_BE,
  AUTH_DATA_BS,
  AUTH_DATA_UP,
  AUTH_DATA_UV,
  buildAuthenticatorData,
  buildClientDataJson,
  buildClientExtensionResults,
  buildCosePublicKey,
  buildPackedSelfAttestationStatement,
  cborEncoder,
  decodeRequiredBase64Url,
  exportSpkiPublicKey,
  joinBytes,
  parseCreationOptions,
  parseRequestOptions,
  resolveRpId,
  serializeCreateResponse,
  serializeGetResponse,
  sha256,
  shouldUsePackedAttestation,
  validateEs256Support,
} from '@/electron/site-passkey/webauthn-crypto'

const PASSKEY_CHALLENGE_MIN_BYTES = 16
const PASSKEY_CHALLENGE_MAX_BYTES = 1024
const PASSKEY_USER_HANDLE_MAX_BYTES = 64

function normalizeCredentialIds(values: Array<string | undefined>) {
  return new Set(values.map((value) => normalizeCredentialId(value)).filter((value): value is string => Boolean(value)))
}

function validatedP256PrivateKey(privateKeyJwk: JsonWebKey) {
  if (privateKeyJwk.kty !== 'EC' || privateKeyJwk.crv !== 'P-256') {
    throw new Error('The saved passkey private key is invalid.')
  }

  decodeRequiredBase64Url(privateKeyJwk.x, 'The saved passkey private key is invalid.', { exactBytes: 32 })
  decodeRequiredBase64Url(privateKeyJwk.y, 'The saved passkey private key is invalid.', { exactBytes: 32 })
  decodeRequiredBase64Url(privateKeyJwk.d, 'The saved passkey private key is invalid.', { exactBytes: 32 })
  let privateKey: KeyObject
  let publicKeyJwk: JsonWebKey
  try {
    privateKey = createPrivateKey({ format: 'jwk', key: privateKeyJwk })
    publicKeyJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as JsonWebKey
  } catch {
    throw new Error('The saved passkey private key is invalid.')
  }
  if (publicKeyJwk.x !== privateKeyJwk.x || publicKeyJwk.y !== privateKeyJwk.y) {
    throw new Error('The saved passkey private key is invalid.')
  }
  return privateKey
}

export const createSitePasskeyCredential = ({
  origin,
  requestDetailsJson,
  existingCredentialIds = [],
  userVerified = false,
}: CreateSitePasskeyInput) => {
  const options = parseCreationOptions(requestDetailsJson)
  validateEs256Support(options)

  const excludedCredentialIds = normalizeCredentialIds((options.excludeCredentials ?? []).map((descriptor) => descriptor.id))

  const duplicateCredentialId = Array.from(normalizeCredentialIds(existingCredentialIds)).find((credentialId) =>
    excludedCredentialIds.has(credentialId))
  if (duplicateCredentialId) {
    throw new Error('This site asked Klarkey not to reuse an existing passkey for this account.')
  }

  const challenge = decodeRequiredBase64Url(options.challenge, 'The site did not provide a valid passkey challenge.', {
    minBytes: PASSKEY_CHALLENGE_MIN_BYTES,
    maxBytes: PASSKEY_CHALLENGE_MAX_BYTES,
  })
  const userHandle = decodeRequiredBase64Url(options.user?.id, 'The site did not provide a valid passkey user id.', {
    minBytes: 1,
    maxBytes: PASSKEY_USER_HANDLE_MAX_BYTES,
  })
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
    flags: AUTH_DATA_UP | (userVerified ? AUTH_DATA_UV : 0) | AUTH_DATA_BE | AUTH_DATA_BS | AUTH_DATA_AT,
    signCount: 0,
    credentialId,
    publicKey: publicKeyCose,
  })
  const clientDataJSON = buildClientDataJson('webauthn.create', challenge, origin)
  const usesPackedAttestation = shouldUsePackedAttestation(options)
  const attestationStatement = usesPackedAttestation
    ? buildPackedSelfAttestationStatement({
        authenticatorData,
        clientDataJSON,
        privateKeyJwk,
      })
    : new Map()
  const attestationObject = Buffer.from(
    cborEncoder.encode(
      new Map<string, unknown>([
        ['fmt', usesPackedAttestation ? 'packed' : 'none'],
        ['attStmt', attestationStatement],
        ['authData', Buffer.from(authenticatorData)],
      ]),
    ),
  )
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

export const getSitePasskeyAssertion = ({ origin, requestDetailsJson, passkey, userVerified = false }: GetSitePasskeyInput) => {
  const options = parseRequestOptions(requestDetailsJson)
  const challenge = decodeRequiredBase64Url(options.challenge, 'The site did not provide a valid passkey challenge.', {
    minBytes: PASSKEY_CHALLENGE_MIN_BYTES,
    maxBytes: PASSKEY_CHALLENGE_MAX_BYTES,
  })
  const rpId = resolveRpId(origin, options.rpId)
  if (passkey.rpId !== rpId) {
    throw new Error('The saved passkey does not belong to this relying party.')
  }
  const requestedCredentialIds = normalizeCredentialIds((options.allowCredentials ?? []).map((descriptor) => descriptor.id))
  if (requestedCredentialIds.size > 0 && !requestedCredentialIds.has(passkey.credentialId)) {
    throw new Error('The site did not request this passkey credential.')
  }
  const clientDataJSON = buildClientDataJson('webauthn.get', challenge, origin)
  const nextSignCount = 0
  const authenticatorData = buildAuthenticatorData({
    rpId,
    flags: AUTH_DATA_UP | (userVerified ? AUTH_DATA_UV : 0) | AUTH_DATA_BE | AUTH_DATA_BS,
    signCount: nextSignCount,
  })
  const signatureBase = joinBytes(authenticatorData, sha256(clientDataJSON))
  const signature = sign(
    'sha256',
    signatureBase,
    validatedP256PrivateKey(passkey.privateKeyJwk),
  )
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
