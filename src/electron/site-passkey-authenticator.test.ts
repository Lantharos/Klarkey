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
})
