import { createPublicKey, verify } from 'node:crypto'
import { parseSshPublicKey, prepareStoredSshKey, signSshPayload } from '@/electron/ssh'

const readString = (buffer: Buffer, offset: number) => {
  const length = buffer.readUInt32BE(offset)
  const start = offset + 4
  const end = start + length
  return {
    value: buffer.subarray(start, end),
    nextOffset: end,
  }
}

const readSshString = (buf: Buffer, offset: number) => {
  const len = buf.readUInt32BE(offset)
  offset += 4
  return { value: buf.subarray(offset, offset + len), nextOffset: offset + len }
}

const toBase64Url = (value: Buffer) => value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const createPublicKeyFromSsh = (sshPublicKey: string) => {
  const { algorithm, blob } = parseSshPublicKey(sshPublicKey)

  if (algorithm === 'ssh-ed25519') {
    const { nextOffset } = readSshString(blob, 0) // skip algorithm name
    const { value: pubKey } = readSshString(blob, nextOffset)
    return createPublicKey({
      format: 'jwk',
      key: { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(pubKey) },
    })
  }

  if (algorithm === 'ssh-rsa') {
    const { nextOffset: off1 } = readSshString(blob, 0) // skip algorithm name
    const { value: e, nextOffset: off2 } = readSshString(blob, off1)
    const { value: n } = readSshString(blob, off2)
    return createPublicKey({
      format: 'jwk',
      key: { kty: 'RSA', e: toBase64Url(e), n: toBase64Url(n) },
    })
  }

  throw new Error('Unsupported algorithm')
}

// Test fixtures — unencrypted OpenSSH-format private keys generated with ssh-keygen
const OPENSSH_ED25519_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBzZm7PZv7n0GrEFCr+PDckLKtjIlElwRb/ojooNk1q3AAAAJiS151Akted
QAAAAAtzc2gtZWQyNTUxOQAAACBzZm7PZv7n0GrEFCr+PDckLKtjIlElwRb/ojooNk1q3A
AAAED+znRLntNc3u9/YNy0w7CElFzXbuEgu64oC5HJEL1YHnNmbs9m/ufQasQUKv48NyQs
q2MiUSXBFv+iOig2TWrcAAAAEHRlc3RAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----`

const OPENSSH_RSA_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABFwAAAAdzc2gtcn
NhAAAAAwEAAQAAAQEArphgS3LSJZlDWhYsDreoTvWtkknwmaSu0o5iosKaSINdwEDdfLrD
ZodQElTL8ozgHPD6VnUcBjwvbmjFep4jIUPXO1IZzQaVH6D2KOBMiPPN0h6faXkR4fUXdt
RnSRJ7xtzVmufoi5qt0/3Dn88h5pLXrRDgpZ2WpcGSiPL7yF5Wa2XwcAXK8YE9zgLDfKU7
Cq+8VRcRmtAaywlAyodvnrr+8yXSfiGisWGCz1Ds/qIzSGU8b4/H+ESoUhbgh5Y8DXZT2f
3PvDzrF31gWumkLzkwaftD9ojt7I66JwQYYRTY14EIbwOwh6gqydqqOSl7l7CxDIrU2cFM
ZBZ7RCLgHwAAA8gjt4axI7eGsQAAAAdzc2gtcnNhAAABAQCumGBLctIlmUNaFiwOt6hO9a
2SSfCZpK7SjmKiwppIg13AQN18usNmh1ASVMvyjOAc8PpWdRwGPC9uaMV6niMhQ9c7UhnN
BpUfoPYo4EyI883SHp9peRHh9Rd21GdJEnvG3NWa5+iLmq3T/cOfzyHmktetEOClnZalwZ
KI8vvIXlZrZfBwBcrxgT3OAsN8pTsKr7xVFxGa0BrLCUDKh2+euv7zJdJ+IaKxYYLPUOz+
ojNIZTxvj8f4RKhSFuCHljwNdlPZ/c+8POsXfWBa6aQvOTBp+0P2iO3sjronBBhhFNjXgQ
hvA7CHqCrJ2qo5KXuXsLEMitTZwUxkFntEIuAfAAAAAwEAAQAAAQB29h/2iH+jWrBHe3/9
byng0wi2+mZTaaAsmxOd7paM/eUtD4VabS6id2QZeWmVFGPHlHId4qF7phpzUjPr/j/VdJ
H8O06VIf0NlfDjnSDI18XPe0oG5ZVHrmWUc9kEMvHfZ6yrZYRPSs9R+EAIbWud3UPTCgLn
FV8GBcTARz9DH9OK+6TmKXeTNmnGCeqETIgMZp1w7+4C7/QVlFD6uUxvPRi4txi4e+MK13
kGxexrX+Rfvwqyalq4cNBcvGioOOf30li9ZmpjVUvI7QskH+vPQklNPgKdcWm2hBhX4LVX
f3aWqsOOJv6Fv/PgBGgj2/BVP68vC9Ubux3rOSU6s9aRAAAAgQCdZTWd28oPAukefVrXJY
rPHiP5WIqrE+WKP6Rej9LkGLmCW5wT0iihCvjB3BQQfs2OcYPTEvywdb9XvScYdF1yv2nJ
HNaSB7uZoYcp3FW2pBfv3c804D5v+612phX6R3QgMUiH0cbTuRi8D51NAJjpY7/jMmG6+X
BpYaZMInhcSwAAAIEA4E1xwHzYVIun14+B9Tg950MyfgEeVUoB7DZNoGQiIJEeJ1zYsl3i
assbFjLNNQ5UoQQqWXoOOXcPB2v4RJBki8g5bervjFSDaCzenrNulkSaY4xa2ylYyvNMpf
KJ4hQr3od9JdWZ+qMH+hOkNJ4KUhKB33MJ0lAzDJ68v9DxHC0AAACBAMdErdJPB3RUgFZ5
1GaUWX9SUKRR8h1EQwl0+z9zE1IZm9VXQzjfMnt/nhrkaXdVB4zhLdvUjvQuG2a8GpxxjL
Q+tkMM1mzm30v1fx8eK4P5d9jlbWjiiZZVN063QHlf/wmqKgIUWPpUOJMis6qiZvMG/RmX
Dk3Ekc44xaK1FUD7AAAAEHRlc3RAZXhhbXBsZS5jb20BAg==
-----END OPENSSH PRIVATE KEY-----`

describe('ssh helpers', () => {
  it('generates a vault-stored ed25519 ssh identity', () => {
    const prepared = prepareStoredSshKey({ itemName: 'GitHub signing key' })

    expect(prepared.algorithm).toBe('ssh-ed25519')
    expect(prepared.publicKey.startsWith('ssh-ed25519 ')).toBe(true)
    expect(prepared.privateKey.includes('BEGIN PRIVATE KEY')).toBe(true)
    expect(prepared.fingerprint.startsWith('SHA256:')).toBe(true)
  })

  it('signs payloads using ssh-ed25519 encoding', () => {
    const prepared = prepareStoredSshKey({ itemName: 'Deploy key', comment: 'deploy@example' })
    const payload = Buffer.from('klarkey-signature-check', 'utf8')

    const signatureBlob = signSshPayload(
      {
        itemId: 'item_1',
        itemName: 'Deploy key',
        algorithm: prepared.algorithm,
        fingerprint: prepared.fingerprint,
        publicKey: prepared.publicKey,
        privateKey: prepared.privateKey,
        comment: prepared.comment,
      },
      payload,
      0,
    )

    const algorithm = readString(signatureBlob, 0)
    const signature = readString(signatureBlob, algorithm.nextOffset)

    expect(algorithm.value.toString('utf8')).toBe('ssh-ed25519')

    const verified = verify(null, payload, createPublicKey(prepared.privateKey), signature.value)
    expect(verified).toBe(true)

    const parsed = parseSshPublicKey(prepared.publicKey)
    expect(parsed.algorithm).toBe('ssh-ed25519')
    expect(parsed.blob.length).toBeGreaterThan(16)
  })

  it('imports an OpenSSH-format ed25519 private key', () => {
    const prepared = prepareStoredSshKey({
      itemName: '1Password export',
      privateKey: OPENSSH_ED25519_KEY,
      comment: 'test@example.com',
    })

    expect(prepared.algorithm).toBe('ssh-ed25519')
    expect(prepared.publicKey).toBe(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHNmbs9m/ufQasQUKv48NyQsq2MiUSXBFv+iOig2TWrc test@example.com',
    )
    expect(prepared.fingerprint).toBe('SHA256:H7jumo8HtRxM1SPcIgjbse1IMhwW7EGDqW8E5LQ45Ok')
    expect(prepared.privateKey).toBe(OPENSSH_ED25519_KEY)
  })

  it('signs payloads using an imported OpenSSH-format ed25519 key', () => {
    const prepared = prepareStoredSshKey({
      itemName: '1Password export',
      privateKey: OPENSSH_ED25519_KEY,
      comment: 'test@example.com',
    })
    const payload = Buffer.from('klarkey-signature-check', 'utf8')

    const signatureBlob = signSshPayload(
      {
        itemId: 'item_2',
        itemName: '1Password export',
        algorithm: prepared.algorithm,
        fingerprint: prepared.fingerprint,
        publicKey: prepared.publicKey,
        privateKey: prepared.privateKey,
        comment: prepared.comment,
      },
      payload,
      0,
    )

    const algorithm = readString(signatureBlob, 0)
    const signature = readString(signatureBlob, algorithm.nextOffset)

    expect(algorithm.value.toString('utf8')).toBe('ssh-ed25519')

    const verified = verify(null, payload, createPublicKeyFromSsh(prepared.publicKey), signature.value)
    expect(verified).toBe(true)
  })

  it('imports an OpenSSH-format rsa private key', () => {
    const prepared = prepareStoredSshKey({
      itemName: '1Password RSA export',
      privateKey: OPENSSH_RSA_KEY,
      comment: 'test@example.com',
    })

    expect(prepared.algorithm).toBe('ssh-rsa')
    expect(prepared.publicKey).toBe(
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCumGBLctIlmUNaFiwOt6hO9a2SSfCZpK7SjmKiwppIg13AQN18usNmh1ASVMvyjOAc8PpWdRwGPC9uaMV6niMhQ9c7UhnNBpUfoPYo4EyI883SHp9peRHh9Rd21GdJEnvG3NWa5+iLmq3T/cOfzyHmktetEOClnZalwZKI8vvIXlZrZfBwBcrxgT3OAsN8pTsKr7xVFxGa0BrLCUDKh2+euv7zJdJ+IaKxYYLPUOz+ojNIZTxvj8f4RKhSFuCHljwNdlPZ/c+8POsXfWBa6aQvOTBp+0P2iO3sjronBBhhFNjXgQhvA7CHqCrJ2qo5KXuXsLEMitTZwUxkFntEIuAf test@example.com',
    )
    expect(prepared.fingerprint).toBe('SHA256:vw2bpH/xPxgWNOSs7fB78IpKVd+7SMt/iGwgb2EZgC8')
    expect(prepared.privateKey).toBe(OPENSSH_RSA_KEY)
  })

  it('signs payloads using an imported OpenSSH-format rsa key', () => {
    const prepared = prepareStoredSshKey({
      itemName: '1Password RSA export',
      privateKey: OPENSSH_RSA_KEY,
      comment: 'test@example.com',
    })
    const payload = Buffer.from('klarkey-signature-check', 'utf8')

    const signatureBlob = signSshPayload(
      {
        itemId: 'item_3',
        itemName: '1Password RSA export',
        algorithm: prepared.algorithm,
        fingerprint: prepared.fingerprint,
        publicKey: prepared.publicKey,
        privateKey: prepared.privateKey,
        comment: prepared.comment,
      },
      payload,
      0,
    )

    const algorithm = readString(signatureBlob, 0)
    const signature = readString(signatureBlob, algorithm.nextOffset)

    expect(algorithm.value.toString('utf8')).toBe('ssh-rsa')

    const verified = verify('sha1', payload, createPublicKeyFromSsh(prepared.publicKey), signature.value)
    expect(verified).toBe(true)
  })
})
