import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { CreateItemInput, ItemDetails, ItemProfile, UpdateItemInput } from '@/shared/types'

const SSH_AGENT_RSA_SHA2_256 = 0x00000002
const SSH_AGENT_RSA_SHA2_512 = 0x00000004

type SupportedSshAlgorithm = 'ssh-ed25519' | 'ssh-rsa'

export type StoredSshKey = {
  algorithm: SupportedSshAlgorithm
  publicKey: string
  privateKey: string
  fingerprint: string
  comment: string
}

export type SshIdentityRecord = {
  itemId: string
  itemName: string
  algorithm: SupportedSshAlgorithm
  fingerprint: string
  publicKey: string
  comment: string
}

export type SshPrivateIdentityRecord = SshIdentityRecord & {
  privateKey: string
}

const PEM_PRIVATE_KEY_PATTERN = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m

type JwkOkp = { kty: 'OKP'; crv: string; x: string }
type JwkRsa = { kty: 'RSA'; e: string; n: string }

const MAX_SSH_STRING_BYTES = 256 * 1024
const MAX_SSH_PUBLIC_KEY_BLOB_BYTES = 16 * 1024
const MAX_RSA_EXPONENT_BYTES = 8
const MAX_RSA_MODULUS_BYTES = 1024
const standardBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/

const encodeUint32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

const encodeString = (value: Buffer | Uint8Array | string) => {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return Buffer.concat([encodeUint32(bytes.length), bytes])
}

const encodeMpint = (value: Buffer) => {
  const normalized = trimLeadingZeroes(value)
  if (normalized.length === 0) {
    return encodeString(Buffer.alloc(0))
  }

  const needsLeadingZero = (normalized[0] & 0x80) !== 0
  const prefixed = needsLeadingZero ? Buffer.concat([Buffer.from([0]), normalized]) : normalized
  return encodeString(prefixed)
}

const trimLeadingZeroes = (value: Buffer) => {
  let offset = 0
  while (offset < value.length && value[offset] === 0) {
    offset += 1
  }
  return offset === 0 ? value : value.subarray(offset)
}

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
}

const base64NoPadding = (value: Buffer) => value.toString('base64').replace(/=+$/g, '')

const toBase64Url = (value: Buffer) => value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const bigIntToBuffer = (value: bigint) => {
  let hex = value.toString(16)
  if (hex.length % 2 !== 0) hex = '0' + hex
  return Buffer.from(hex, 'hex')
}

const OPENSSH_MAGIC = Buffer.from('openssh-key-v1\u0000', 'ascii')

const isOpenSshPrivateKey = (pem: string) => pem.trim().startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')

const readSshString = (buf: Buffer, offset: number): [Buffer, number] => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > buf.length) {
    throw new Error('Malformed SSH key.')
  }
  const len = buf.readUInt32BE(offset)
  offset += 4
  if (len > MAX_SSH_STRING_BYTES || offset + len > buf.length) {
    throw new Error('Malformed SSH key.')
  }
  return [buf.subarray(offset, offset + len), offset + len]
}

const decodeSshPublicKeyBlob = (encodedBlob: string) => {
  const normalized = encodedBlob.trim().replace(/=+$/g, '')
  if (
    !normalized ||
    normalized.length > Math.ceil(MAX_SSH_PUBLIC_KEY_BLOB_BYTES / 3) * 4 ||
    normalized.length % 4 === 1 ||
    !standardBase64Pattern.test(encodedBlob)
  ) {
    throw new Error('SSH public key blob is not valid base64.')
  }

  const decoded = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
  if (decoded.length === 0 || decoded.length > MAX_SSH_PUBLIC_KEY_BLOB_BYTES) {
    throw new Error('SSH public key blob is out of range.')
  }
  if (decoded.toString('base64').replace(/=+$/g, '') !== normalized) {
    throw new Error('SSH public key blob is not valid base64.')
  }
  return decoded
}

const parseOpenSshPrivateKey = (pem: string) => {
  const base64 = pem
    .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/g, '')
    .replace(/-----END OPENSSH PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const data = Buffer.from(base64, 'base64')

  if (data.length < 15 || !data.subarray(0, 15).equals(OPENSSH_MAGIC)) {
    throw new Error('Invalid OpenSSH private key format.')
  }

  let offset = 15
  const [cipherName, off1] = readSshString(data, offset)
  const [kdfName, off2] = readSshString(data, off1)
  const [, off3] = readSshString(data, off2)
  offset = off3

  if (cipherName.toString('ascii') !== 'none' || kdfName.toString('ascii') !== 'none') {
    throw new Error('Encrypted OpenSSH private keys are not supported yet.')
  }

  const numKeys = data.readUInt32BE(offset)
  offset += 4

  for (let i = 0; i < numKeys; i++) {
    const [, next] = readSshString(data, offset)
    offset = next
  }

  const [privateSection] = readSshString(data, offset)
  let pOffset = 0

  const checkint1 = privateSection.readUInt32BE(pOffset)
  pOffset += 4
  const checkint2 = privateSection.readUInt32BE(pOffset)
  pOffset += 4

  if (checkint1 !== checkint2) {
    throw new Error('Corrupt OpenSSH private key.')
  }

  const [keyType, kOff1] = readSshString(privateSection, pOffset)

  if (keyType.toString('ascii') === 'ssh-ed25519') {
    const [, kOff2] = readSshString(privateSection, kOff1)
    const [privateKeyBytes] = readSshString(privateSection, kOff2)

    if (privateKeyBytes.length !== 64) {
      throw new Error('Invalid Ed25519 private key length.')
    }

    const seed = privateKeyBytes.subarray(0, 32)
    const x = privateKeyBytes.subarray(32, 64)

    const jwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519',
      x: toBase64Url(x),
      d: toBase64Url(seed),
    }

    const privateKey = createPrivateKey({ format: 'jwk', key: jwk })
    const publicKeyObj = createPublicKey(privateKey)
    const publicJwk = publicKeyObj.export({ format: 'jwk' }) as JwkOkp
    return { privateKey, privateType: 'ed25519' as const, publicJwk }
  }

  if (keyType.toString('ascii') === 'ssh-rsa') {
    const [nBuf, off1] = readSshString(privateSection, kOff1)
    const [eBuf, off2] = readSshString(privateSection, off1)
    const [dBuf, off3] = readSshString(privateSection, off2)
    const [iqmpBuf, off4] = readSshString(privateSection, off3)
    const [pBuf, off5] = readSshString(privateSection, off4)
    const [qBuf] = readSshString(privateSection, off5)

    const pBig = BigInt('0x' + pBuf.toString('hex'))
    const qBig = BigInt('0x' + qBuf.toString('hex'))
    const dBig = BigInt('0x' + dBuf.toString('hex'))
    const dpBig = dBig % (pBig - 1n)
    const dqBig = dBig % (qBig - 1n)

    const jwk = {
      kty: 'RSA' as const,
      n: toBase64Url(nBuf),
      e: toBase64Url(eBuf),
      d: toBase64Url(dBuf),
      p: toBase64Url(pBuf),
      q: toBase64Url(qBuf),
      dp: toBase64Url(bigIntToBuffer(dpBig)),
      dq: toBase64Url(bigIntToBuffer(dqBig)),
      qi: toBase64Url(iqmpBuf),
    }

    const privateKey = createPrivateKey({ format: 'jwk', key: jwk })
    const publicKeyObj = createPublicKey(privateKey)
    const publicJwk = publicKeyObj.export({ format: 'jwk' }) as JwkRsa
    return { privateKey, privateType: 'rsa' as const, publicJwk }
  }

  throw new Error('Unsupported OpenSSH key type: ' + keyType.toString('ascii'))
}

const readJwk = (privateKeyPem: string) => {
  if (isOpenSshPrivateKey(privateKeyPem)) {
    return parseOpenSshPrivateKey(privateKeyPem)
  }
  const privateKey = createPrivateKey(privateKeyPem)
  const publicKey = createPublicKey(privateKey)
  const privateType = privateKey.asymmetricKeyType
  const publicJwk = publicKey.export({ format: 'jwk' }) as JwkOkp | JwkRsa
  return { privateKey, privateType, publicJwk }
}

const importPrivateKey = (privateKeyPem: string) => {
  if (isOpenSshPrivateKey(privateKeyPem)) {
    return parseOpenSshPrivateKey(privateKeyPem).privateKey
  }
  return createPrivateKey(privateKeyPem)
}

const sshBlobFromPrivateKey = (privateKeyPem: string): { algorithm: SupportedSshAlgorithm; blob: Buffer } => {
  const { privateType, publicJwk } = readJwk(privateKeyPem)

  if (privateType === 'ed25519' && publicJwk.kty === 'OKP') {
    return {
      algorithm: 'ssh-ed25519',
      blob: Buffer.concat([
        encodeString('ssh-ed25519'),
        encodeString(decodeBase64Url(publicJwk.x)),
      ]),
    }
  }

  if (privateType === 'rsa' && publicJwk.kty === 'RSA') {
    return {
      algorithm: 'ssh-rsa',
      blob: Buffer.concat([
        encodeString('ssh-rsa'),
        encodeMpint(decodeBase64Url(publicJwk.e)),
        encodeMpint(decodeBase64Url(publicJwk.n)),
      ]),
    }
  }

  throw new Error('Only Ed25519 and RSA SSH keys are supported right now.')
}

export const buildSshPublicKey = (privateKeyPem: string, comment: string) => {
  const { algorithm, blob } = sshBlobFromPrivateKey(privateKeyPem)
  const suffix = comment.trim() ? ` ${comment.trim()}` : ''
  return `${algorithm} ${blob.toString('base64')}${suffix}`
}

export const buildSshFingerprint = (publicKey: string) => {
  const blob = parseSshPublicKey(publicKey).blob
  return `SHA256:${base64NoPadding(createHash('sha256').update(blob).digest())}`
}

export const generateEd25519PrivateKey = () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
}

export const prepareStoredSshKey = (params: {
  itemName: string
  privateKey?: string
  comment?: string
}) => {
  const resolvedPrivateKey = params.privateKey?.trim() || generateEd25519PrivateKey()
  if (params.privateKey?.trim() && !PEM_PRIVATE_KEY_PATTERN.test(resolvedPrivateKey)) {
    throw new Error(
      resolvedPrivateKey.startsWith('ssh-')
        ? 'Paste the SSH private key into the private key field. Public keys belong in the copy-only public key field.'
        : 'SSH private key import must be a PEM private key block.',
    )
  }
  const resolvedComment = params.comment?.trim() || `${params.itemName.trim() || 'klarkey'}@klarkey`
  const publicKey = buildSshPublicKey(resolvedPrivateKey, resolvedComment)
  return {
    algorithm: parseSshPublicKey(publicKey).algorithm,
    publicKey,
    privateKey: resolvedPrivateKey,
    fingerprint: buildSshFingerprint(publicKey),
    comment: resolvedComment,
  } satisfies StoredSshKey
}

export const parseSshPublicKey = (value: string) => {
  const trimmed = value.trim()
  const [algorithm, encodedBlob] = trimmed.split(/\s+/, 3)
  if (!algorithm || !encodedBlob) {
    throw new Error('SSH public key is not in OpenSSH format.')
  }

  if (algorithm !== 'ssh-ed25519' && algorithm !== 'ssh-rsa') {
    throw new Error('Only Ed25519 and RSA SSH public keys are supported right now.')
  }

  const blob = decodeSshPublicKeyBlob(encodedBlob)
  const [innerAlgorithm, offset] = readSshString(blob, 0)
  if (innerAlgorithm.toString('ascii') !== algorithm) {
    throw new Error('SSH public key algorithm does not match its key blob.')
  }

  if (algorithm === 'ssh-ed25519') {
    const [publicKey, nextOffset] = readSshString(blob, offset)
    if (publicKey.length !== 32 || nextOffset !== blob.length) {
      throw new Error('SSH Ed25519 public key blob is invalid.')
    }
  } else {
    const [exponent, nextOffset] = readSshString(blob, offset)
    const [modulus, finalOffset] = readSshString(blob, nextOffset)
    if (
      exponent.length < 1 ||
      exponent.length > MAX_RSA_EXPONENT_BYTES ||
      modulus.length < 128 ||
      modulus.length > MAX_RSA_MODULUS_BYTES ||
      finalOffset !== blob.length
    ) {
      throw new Error('SSH RSA public key blob is invalid.')
    }
  }

  return {
    algorithm,
    blob,
  } as const
}

export const replaceSshPublicKeyComment = (value: string, comment: string) => {
  const trimmed = value.trim()
  const [algorithm, encodedBlob] = trimmed.split(/\s+/, 3)
  if (!algorithm || !encodedBlob) {
    throw new Error('SSH public key is not in OpenSSH format.')
  }

  return `${algorithm} ${encodedBlob}${comment.trim() ? ` ${comment.trim()}` : ''}`
}

export const createGitSigningSnippet = (publicKey: string) => {
  return [
    '[gpg]',
    '  format = ssh',
    '[user]',
    `  signingkey = ${publicKey.trim()}`,
    '[commit]',
    '  gpgsign = true',
  ].join('\n')
}

const buildSshSignatureBlob = (algorithm: string, signature: Buffer) => {
  return Buffer.concat([
    encodeString(algorithm),
    encodeString(signature),
  ])
}

export const signSshPayload = (identity: SshPrivateIdentityRecord, payload: Buffer, flags = 0) => {
  const privateKey = importPrivateKey(identity.privateKey)

  if (identity.algorithm === 'ssh-ed25519') {
    return buildSshSignatureBlob('ssh-ed25519', signBytes(null, payload, privateKey))
  }

  if ((flags & SSH_AGENT_RSA_SHA2_512) !== 0) {
    return buildSshSignatureBlob('rsa-sha2-512', signBytes('sha512', payload, privateKey))
  }

  if ((flags & SSH_AGENT_RSA_SHA2_256) !== 0) {
    return buildSshSignatureBlob('rsa-sha2-256', signBytes('sha256', payload, privateKey))
  }

  return buildSshSignatureBlob('ssh-rsa', signBytes('sha1', payload, privateKey))
}

export const normalizeSshItemInput = (input: CreateItemInput | UpdateItemInput, itemName: string) => {
  const privateKey = input.sshPrivateKey?.trim()
  const isCreateInput = !('itemId' in input)
  const isSshKey = input.itemType === 'ssh-key'

  if (!isSshKey && !privateKey) {
    return undefined
  }

  if (privateKey || (isCreateInput && isSshKey)) {
    return prepareStoredSshKey({
      itemName,
      privateKey,
      comment: input.sshComment,
    })
  }

  return undefined
}

export const toSshIdentityRecord = (item: ItemDetails | ItemProfile & { sshPrivateKey?: string }): SshPrivateIdentityRecord | undefined => {
  if (item.itemType !== 'ssh-key' || !item.sshAlgorithm || !item.sshFingerprint || !item.sshPublicKey || !item.sshComment) {
    return undefined
  }

  const privateKey = 'sshPrivateKey' in item ? item.sshPrivateKey : undefined
  if (!privateKey) {
    return undefined
  }

  return {
    itemId: 'itemId' in item ? item.itemId : item.id,
    itemName: item.itemName,
    algorithm: item.sshAlgorithm as SupportedSshAlgorithm,
    fingerprint: item.sshFingerprint,
    publicKey: item.sshPublicKey,
    privateKey,
    comment: item.sshComment,
  }
}
