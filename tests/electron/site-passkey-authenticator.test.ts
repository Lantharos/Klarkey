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

  it('allows an origin to use a parent-domain relying party id', () => {
    const result = createSitePasskeyCredential({
      origin: 'https://login.example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    expect(result.rpId).toBe('example.com')
  })

  it('rejects cross-site relying party ids during registration', () => {
    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://evil.test',
        requestDetailsJson: JSON.stringify(createOptions),
      }),
    ).toThrow('does not match')
  })

  it('rejects public suffix relying party ids', () => {
    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://example.co.uk',
        requestDetailsJson: JSON.stringify({
          ...createOptions,
          rp: {
            id: 'co.uk',
            name: 'Bad RP',
          },
        }),
      }),
    ).toThrow('public suffix')

    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://project.github.io',
        requestDetailsJson: JSON.stringify({
          ...createOptions,
          rp: {
            id: 'github.io',
            name: 'Bad RP',
          },
        }),
      }),
    ).toThrow('public suffix')
  })

  it('rejects cross-site relying party ids during authentication', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    expect(() =>
      getSitePasskeyAssertion({
        origin: 'https://evil.test',
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
      }),
    ).toThrow('does not match')
  })

  it('rejects malformed or undersized passkey challenges', () => {
    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://example.com',
        requestDetailsJson: JSON.stringify({
          ...createOptions,
          challenge: 'abc',
        }),
      }),
    ).toThrow('valid passkey challenge')
  })

  it('rejects oversized user handles during registration', () => {
    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://example.com',
        requestDetailsJson: JSON.stringify({
          ...createOptions,
          user: {
            ...createOptions.user,
            id: Buffer.alloc(65, 1).toString('base64url'),
          },
        }),
      }),
    ).toThrow('valid passkey user id')
  })

  it('honors excluded credentials during registration', () => {
    const existingCredentialId = Buffer.alloc(32, 6).toString('base64url')

    expect(() =>
      createSitePasskeyCredential({
        origin: 'https://example.com',
        requestDetailsJson: JSON.stringify({
          ...createOptions,
          excludeCredentials: [
            {
              id: existingCredentialId,
              type: 'public-key',
            },
          ],
        }),
        existingCredentialIds: [existingCredentialId],
      }),
    ).toThrow('not to reuse')
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

  it('creates an assertion for a stored synced passkey with sign count zero', () => {
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
    expect(assertion.signCount).toBe(0)
    expect(response.id).toBe(created.credentialId)
    expect(response.response.signature).toBeTruthy()
    expect(response.response.userHandle).toBe(created.userHandle)
  })

  it('rejects assertions when the saved relying party id differs from the request', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    expect(() =>
      getSitePasskeyAssertion({
        origin: 'https://example.com',
        requestDetailsJson: JSON.stringify({
          challenge: 'EA8ODQwLCgkIBwYFBAMCAQ',
          rpId: 'example.com',
        }),
        passkey: {
          credentialId: created.credentialId,
          rpId: 'login.example.com',
          userHandle: created.userHandle,
          signCount: 0,
          privateKeyJwk: created.privateKeyJwk,
        },
      }),
    ).toThrow('does not belong')
  })

  it('rejects assertions when allowCredentials does not include the selected passkey', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    expect(() =>
      getSitePasskeyAssertion({
        origin: 'https://example.com',
        requestDetailsJson: JSON.stringify({
          challenge: 'EA8ODQwLCgkIBwYFBAMCAQ',
          rpId: 'example.com',
          allowCredentials: [
            {
              id: Buffer.alloc(32, 9).toString('base64url'),
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
      }),
    ).toThrow('did not request')
  })

  it('rejects saved passkey private keys that are not P-256 private JWKs', () => {
    const created = createSitePasskeyCredential({
      origin: 'https://example.com',
      requestDetailsJson: JSON.stringify(createOptions),
    })

    expect(() =>
      getSitePasskeyAssertion({
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
          privateKeyJwk: {
            ...created.privateKeyJwk,
            d: Buffer.alloc(31, 3).toString('base64url'),
          },
        },
      }),
    ).toThrow('private key is invalid')

    expect(() =>
      getSitePasskeyAssertion({
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
          privateKeyJwk: {
            ...created.privateKeyJwk,
            x: Buffer.alloc(32, 9).toString('base64url'),
          },
        },
      }),
    ).toThrow('private key is invalid')
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
