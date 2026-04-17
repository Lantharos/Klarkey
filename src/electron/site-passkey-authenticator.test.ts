import { decode as decodeCbor } from 'cbor-x'
import { decodeBase64Url } from '@/shared/passkey-encoding'
import { createSitePasskeyCredential, getSitePasskeyAssertion } from '@/electron/site-passkey-authenticator'

const createOptions = {
  challenge: 'AQIDBAUGBwgJCgsMDQ4PEA',
  rp: {
    id: 'example.com',
    name: 'Example',
  },
  user: {
    id: 'AQIDBAUGBwgJCgsMDQ4PEA',
    name: 'kristof@example.com',
    displayName: 'Kristof',
  },
  pubKeyCredParams: [
    {
      type: 'public-key',
      alg: -7,
    },
  ],
}

describe('site passkey authenticator', () => {
  const readDecodedField = (value: unknown, key: string) =>
    value instanceof Map ? value.get(key) : (value as Record<string, unknown>)[key]

  it('creates a WebAuthn attestation response with a stored private key', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })
    const response = JSON.parse(result.responseJson)
    const attestationObject = decodeCbor(decodeBase64Url(response.response.attestationObject))

    expect(result.credentialId).toBe(response.id)
    expect(result.rpId).toBe('example.com')
    expect(result.userHandle).toBe(createOptions.user.id)
    expect(readDecodedField(attestationObject, 'fmt')).toBe('none')
    expect(Array.isArray(response.response.transports)).toBe(true)
    expect(response.response.publicKeyAlgorithm).toBe(-7)
  })

  it('encodes attestation authData and COSE keys as plain CBOR byte strings', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })
    const response = JSON.parse(result.responseJson)
    const attestationBytes = Buffer.from(decodeBase64Url(response.response.attestationObject))
    const attestationObject = decodeCbor(attestationBytes)
    const authData = Buffer.from(readDecodedField(attestationObject, 'authData') as Uint8Array)
    const credentialIdLength = authData.readUInt16BE(53)
    const credentialPublicKeyOffset = 55 + credentialIdLength

    expect(attestationBytes[0]).toBe(0xa3)
    expect(attestationBytes.includes(Buffer.from([0xd8, 0x40, 0x58]))).toBe(false)
    expect(authData[credentialPublicKeyOffset]).toBe(0xa5)
  })

  it('encodes the attestation object as a CBOR map', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })
    const response = JSON.parse(result.responseJson)
    const attestationBytes = Buffer.from(decodeBase64Url(response.response.attestationObject))
    const attestationObject = decodeCbor(attestationBytes)

    expect(attestationBytes[0]).toBe(0xa3)
    expect(readDecodedField(attestationObject, 'attStmt')).toEqual({})
  })

  it('emits packed self attestation when the site requests attestation', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify({
        ...createOptions,
        attestation: 'direct',
      }),
    })
    const response = JSON.parse(result.responseJson)
    const attestationObject = decodeCbor(decodeBase64Url(response.response.attestationObject))
    const attStmt = readDecodedField(attestationObject, 'attStmt') as Map<string, unknown> | Record<string, unknown>
    const alg = readDecodedField(attStmt, 'alg')
    const sig = readDecodedField(attStmt, 'sig')

    expect(readDecodedField(attestationObject, 'fmt')).toBe('packed')
    expect(alg).toBe(-7)
    expect(Buffer.from(sig as Uint8Array).length).toBeGreaterThan(0)
  })

  it('reports resident key properties when credProps is requested', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify({
        ...createOptions,
        authenticatorSelection: {
          residentKey: 'required',
        },
        extensions: {
          credProps: true,
        },
      }),
    })
    const response = JSON.parse(result.responseJson)

    expect(response.clientExtensionResults).toEqual({
      credProps: {
        rk: true,
      },
    })
  })

  it('only sets the UV flag when native verification succeeded during registration', () => {
    const unverified = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
      userVerified: false,
    })
    const verified = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
      userVerified: true,
    })
    const unverifiedResponse = JSON.parse(unverified.responseJson)
    const verifiedResponse = JSON.parse(verified.responseJson)
    const unverifiedAuthData = Buffer.from(decodeBase64Url(unverifiedResponse.response.authenticatorData))
    const verifiedAuthData = Buffer.from(decodeBase64Url(verifiedResponse.response.authenticatorData))

    expect(unverifiedAuthData[32] & 0x04).toBe(0)
    expect(verifiedAuthData[32] & 0x04).toBe(0x04)
  })

  it('creates an assertion for a stored passkey and increments the sign count', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    const assertion = getSitePasskeyAssertion({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify({
        challenge: 'EA8ODQwLCgkIBwYFBAMCAQ',
        rpId: 'example.com',
        allowCredentials: [
          {
            id: created.credentialId,
            type: 'public-key',
          },
        ],
      }),
      passkey: {
        credentialId: created.credentialId,
        rpId: created.rpId,
        userHandle: created.userHandle,
        signCount: 0,
        privateKeyJwk: created.privateKeyJwk,
      },
    })
    const response = JSON.parse(assertion.responseJson)

    expect(assertion.credentialId).toBe(created.credentialId)
    expect(assertion.signCount).toBe(1)
    expect(response.id).toBe(created.credentialId)
    expect(response.response.signature).toBeTruthy()
    expect(response.response.userHandle).toBe(created.userHandle)
  })

  it('only sets the UV flag on assertions after native verification succeeds', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })
    const unverifiedAssertion = getSitePasskeyAssertion({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify({
        challenge: 'EA8ODQwLCgkIBwYFBAMCAQ',
        rpId: 'example.com',
      }),
      passkey: {
        credentialId: created.credentialId,
        rpId: created.rpId,
        userHandle: created.userHandle,
        signCount: 0,
        privateKeyJwk: created.privateKeyJwk,
      },
      userVerified: false,
    })
    const verifiedAssertion = getSitePasskeyAssertion({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify({
        challenge: 'EA8ODQwLCgkIBwYFBAMCAQ',
        rpId: 'example.com',
      }),
      passkey: {
        credentialId: created.credentialId,
        rpId: created.rpId,
        userHandle: created.userHandle,
        signCount: 0,
        privateKeyJwk: created.privateKeyJwk,
      },
      userVerified: true,
    })
    const unverifiedResponse = JSON.parse(unverifiedAssertion.responseJson)
    const verifiedResponse = JSON.parse(verifiedAssertion.responseJson)
    const unverifiedAuthData = Buffer.from(decodeBase64Url(unverifiedResponse.response.authenticatorData))
    const verifiedAuthData = Buffer.from(decodeBase64Url(verifiedResponse.response.authenticatorData))

    expect(unverifiedAuthData[32] & 0x04).toBe(0)
    expect(verifiedAuthData[32] & 0x04).toBe(0x04)
  })
})
