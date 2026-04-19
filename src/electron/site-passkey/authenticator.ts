import { generateKeyPairSync, randomBytes, sign, createPrivateKey, type KeyObject } from 'node:crypto'
import { decodeBase64Url, encodeBase64Url } from '@/shared/passkey-encoding'
import type { CreateSitePasskeyInput, GetSitePasskeyInput } from '@/electron/site-passkey/types'
import {
  AUTH_DATA_AT,
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

export const createSitePasskeyCredential = ({
  origin,
  requestDetailsJson,
  existingCredentialIds = [],
  userVerified = false,
}: CreateSitePasskeyInput) => {
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
    flags: AUTH_DATA_UP | (userVerified ? AUTH_DATA_UV : 0) | AUTH_DATA_AT,
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
  const challenge = decodeRequiredBase64Url(options.challenge, 'The site did not provide a passkey challenge.')
  const rpId = resolveRpId(origin, options.rpId)
  const clientDataJSON = buildClientDataJson('webauthn.get', challenge, origin)
  const nextSignCount = passkey.signCount + 1
  const authenticatorData = buildAuthenticatorData({
    rpId,
    flags: AUTH_DATA_UP | (userVerified ? AUTH_DATA_UV : 0),
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
